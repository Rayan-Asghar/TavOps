import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  sheetConnections,
  sheetRowLinks,
  syncJobs,
  users,
} from "@/db/schema";
import { log } from "@/lib/logger";
import {
  appendRow,
  updateRowCells,
  isRetryableSheetsError,
  type ColumnMap,
} from "./sheets";
import { notify } from "./notifications";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

/**
 * How long a job may sit in `running` before it is presumed abandoned.
 *
 * Claiming flips a row to `running`, and nothing else ever moves it back. A
 * crash, a deploy, or the route's 60s maxDuration therefore used to strand jobs
 * in `running` forever — never re-claimed, because the claim only selects
 * `queued`. The client's sheet then goes quietly stale, which is exactly the
 * failure the retry-and-alert path exists to prevent.
 */
const STUCK_AFTER_MINUTES = 5;

/**
 * Stop claiming new work with time to spare inside the route's 60s limit.
 * Being killed mid-write is what creates stuck jobs in the first place.
 */
const TIME_BUDGET_MS = 45_000;

/** 1min, 2min, 4min. Enough to ride out a quota blip without stalling a day. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 16) * 60_000;
}

type ClaimedJob = {
  id: string;
  connectionId: string;
  jobType: string;
  workLogId: string | null;
  revisionId: string | null;
  attempts: number;
  payload: Record<string, unknown> | null;
};

/**
 * Returns abandoned jobs to the queue.
 *
 * Attempts are not reset, so a job that reliably kills the worker still
 * exhausts MAX_ATTEMPTS and ends up `failed` with an admin alert, rather than
 * cycling forever.
 */
async function reclaimStuckJobs(): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE ${syncJobs}
       SET status = 'queued', run_after = now(),
           last_error = 'Reclaimed: the worker stopped before finishing.'
     WHERE ${eq(syncJobs.status, "running")}
       AND ${syncJobs.startedAt} < now() - ${`${STUCK_AFTER_MINUTES} minutes`}::interval
    RETURNING id
  `);
  const count = (rows as unknown as { id: string }[]).length;
  if (count > 0) log.warn("sync.reclaimed_stuck_jobs", { count });
  return count;
}

/**
 * Claims a batch of due jobs atomically.
 *
 * FOR UPDATE SKIP LOCKED is what makes it safe to run this worker on a schedule
 * without a distributed lock: two overlapping invocations take disjoint sets of
 * rows rather than both writing the same row to the client's sheet twice.
 *
 * Ordered and filtered on (status, run_after) so the claim uses
 * `sync_jobs_claim_idx`. `held_until` is honoured here — corrections are
 * withheld from the client briefly so a same-day fix does not reach them as two
 * contradictory rows.
 */
async function claimJobs(limit: number): Promise<ClaimedJob[]> {
  const rows = await db.execute<ClaimedJob>(sql`
    UPDATE ${syncJobs}
       SET status = 'running', attempts = ${syncJobs.attempts} + 1,
           started_at = now()
     WHERE ${syncJobs.id} IN (
       SELECT ${syncJobs.id} FROM ${syncJobs}
        WHERE ${eq(syncJobs.status, "queued")}
          AND ${syncJobs.runAfter} <= now()
          AND (${syncJobs.heldUntil} IS NULL OR ${syncJobs.heldUntil} <= now())
        ORDER BY ${syncJobs.runAfter}
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, connection_id AS "connectionId", job_type AS "jobType",
              work_log_id AS "workLogId", revision_id AS "revisionId",
              attempts, payload
  `);
  return rows as unknown as ClaimedJob[];
}

async function markSuccess(jobId: string, connectionId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "done", finishedAt: new Date(), lastError: null })
      .where(eq(syncJobs.id, jobId));
    await tx
      .update(sheetConnections)
      .set({ lastSyncAt: new Date(), errorMessage: null })
      .where(eq(sheetConnections.id, connectionId));
  });
}

async function markFailure(job: ClaimedJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = isRetryableSheetsError(err);
  const exhausted = job.attempts >= MAX_ATTEMPTS || !retryable;

  if (!exhausted) {
    await db
      .update(syncJobs)
      .set({
        status: "queued",
        lastError: message,
        runAfter: new Date(Date.now() + backoffMs(job.attempts)),
      })
      .where(eq(syncJobs.id, job.id));
    log.warn("sync.job.retrying", {
      jobId: job.id,
      attempts: job.attempts,
      err: message,
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "failed", lastError: message, finishedAt: new Date() })
      .where(eq(syncJobs.id, job.id));
    // The connection itself is marked broken, so the Sync tab says why rather
    // than looking healthy while nothing reaches the client.
    await tx
      .update(sheetConnections)
      .set({ status: "error", errorMessage: message })
      .where(eq(sheetConnections.id, job.connectionId));
  });

  log.error("sync.job.failed", {
    jobId: job.id,
    connectionId: job.connectionId,
    attempts: job.attempts,
    err: message,
  });

  // A permanently failed sync means a client sheet is now silently stale, so
  // it becomes somebody's actionable inbox item rather than a log line.
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.globalRole, "admin"), eq(users.isActive, true)));

  for (const admin of admins) {
    await notify({
      userId: admin.id,
      kind: "sync_failed",
      title: "Google Sheet sync failed",
      body: `Gave up after ${job.attempts} attempts: ${message}`,
      isActionable: true,
      dedupeKey: `sync_failed:${job.connectionId}`,
    });
  }
}

/** One lookup for the whole batch rather than one per job. */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function runSyncWorker(limit = BATCH_SIZE) {
  const startedAt = Date.now();
  const reclaimed = await reclaimStuckJobs();

  const jobs = await claimJobs(limit);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // One query for every developer named in the batch.
  const workedByIds = [
    ...new Set(
      jobs
        .map((j) => (j.payload as Record<string, unknown>)?.workedBy)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const names = await namesFor(workedByIds);

  const connections = new Map<string, typeof sheetConnections.$inferSelect>();
  if (jobs.length > 0) {
    const rows = await db
      .select()
      .from(sheetConnections)
      .where(inArray(sheetConnections.id, [
        ...new Set(jobs.map((j) => j.connectionId)),
      ]));
    for (const c of rows) connections.set(c.id, c);
  }

  for (const job of jobs) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Hand the rest back rather than being killed holding them.
      await db
        .update(syncJobs)
        .set({ status: "queued", runAfter: new Date() })
        .where(eq(syncJobs.id, job.id));
      skipped++;
      continue;
    }

    try {
      const connection = connections.get(job.connectionId);

      if (!connection || connection.status === "archived") {
        await db
          .update(syncJobs)
          .set({
            status: "done",
            finishedAt: new Date(),
            lastError: "Connection removed or archived; skipped.",
          })
          .where(eq(syncJobs.id, job.id));
        skipped++;
        continue;
      }

      if (connection.status === "paused") {
        // Paused is temporary and deliberate, so the job waits rather than
        // being dropped: the client gets the backlog when it resumes.
        await db
          .update(syncJobs)
          .set({
            status: "queued",
            runAfter: new Date(Date.now() + 15 * 60_000),
            lastError: "Connection paused; waiting.",
          })
          .where(eq(syncJobs.id, job.id));
        skipped++;
        continue;
      }

      const p = (job.payload ?? {}) as Record<string, unknown>;

      const values: Record<string, string> = {
        date: new Date(String(p.workDate ?? Date.now()))
          .toISOString()
          .slice(0, 10),
        taskTitle: String(p.taskTitle ?? ""),
        developer: names.get(String(p.workedBy)) ?? "",
        hours: String(p.hours ?? ""),
        // The client-facing line, never the internal note. record-work only
        // queues a job when there is one, so this is always meaningful.
        notes: String(p.clientUpdate ?? ""),
        status: String(p.status ?? ""),
      };

      // Columns the client maintains are theirs. Dropping them here as well as
      // in the config UI means a stale mapping cannot overwrite a client's own
      // notes, which is the kind of bug that costs a relationship.
      const columnMap = Object.fromEntries(
        Object.entries(connection.columnMap as ColumnMap).filter(
          ([, col]) => !connection.clientOwnedColumns.includes(col),
        ),
      );

      if (Object.keys(columnMap).length === 0) {
        throw new Error(
          "Every mapped column is marked client-owned; there is nothing this sheet lets us write.",
        );
      }

      // An existing link means this entity already has a row, so update it in
      // place. Row numbers come from what Google told us on append — never a
      // guess, because a wrong number overwrites an unrelated row.
      const [link] = job.workLogId
        ? await db
            .select()
            .from(sheetRowLinks)
            .where(
              and(
                eq(sheetRowLinks.entityType, "work_log"),
                eq(sheetRowLinks.entityId, job.workLogId),
                eq(sheetRowLinks.connectionId, connection.id),
              ),
            )
            .limit(1)
        : [];

      const existingRow = link ? Number(link.rowKey) : NaN;

      if (connection.mode === "update" && Number.isFinite(existingRow)) {
        await updateRowCells({
          spreadsheetId: connection.spreadsheetId,
          sheetName: connection.tabName,
          rowNumber: existingRow,
          columnMap,
          values,
        });
      } else {
        const { rowNumber } = await appendRow({
          spreadsheetId: connection.spreadsheetId,
          sheetName: connection.tabName,
          columnMap,
          values,
        });

        // Remember where it landed so a later correction can amend that row.
        if (rowNumber && job.workLogId) {
          await db
            .insert(sheetRowLinks)
            .values({
              entityType: "work_log",
              entityId: job.workLogId,
              connectionId: connection.id,
              rowKey: String(rowNumber),
            })
            .onConflictDoNothing();
        }
      }

      await markSuccess(job.id, job.connectionId);
      succeeded++;
    } catch (err) {
      await markFailure(job, err);
      failed++;
    }
  }

  return { reclaimed, claimed: jobs.length, succeeded, failed, skipped };
}
