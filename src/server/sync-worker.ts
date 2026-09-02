import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  sheetConnections,
  sheetRowLinks,
  syncJobs,
  tasks,
  users,
  workLogs,
} from "@/db/schema";
import { log } from "@/lib/logger";
import {
  checkHeaders,
  locateRow,
  toCells,
  type SheetRow,
} from "@/lib/sheet-template";
import {
  appendRows,
  isRetryableSheetsError,
  readHeaderRow,
  readIdColumn,
  updateRows,
} from "./sheets";
import { notify } from "./notifications";

/**
 * Drains queued work-log writes into each project's Google Sheet.
 *
 * One way only. Nothing here reads a sheet value back into the database, so
 * there is no conflict resolution, no duplicate detection and no deletion
 * handling to get wrong. The sheet is a mirror; Tavren is the record.
 *
 * Work is grouped by connection and each group costs a fixed small number of
 * API calls regardless of how many entries it carries: one header check, one id
 * column read, one append, one batched update. The naive shape, a call per job,
 * is what would put this near the per-minute quota during a backfill.
 */

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;

/**
 * How long a job may sit in `running` before it is presumed abandoned.
 *
 * Claiming flips a row to `running` and nothing else moves it back, so a crash
 * or a deploy would otherwise strand it there forever: the claim only selects
 * `queued`. The sheet then goes quietly stale, which is exactly the failure the
 * retry-and-alert path exists to prevent.
 */
const STUCK_AFTER_MINUTES = 5;

/** Stop claiming with time to spare inside a 60s route budget. */
const TIME_BUDGET_MS = 45_000;

/**
 * One drain at a time, process-wide.
 *
 * Every logged entry schedules a drain, so ten people logging at once means ten
 * concurrent calls. SKIP LOCKED keeps that correct — they would take disjoint
 * jobs — but it is pure waste: ten reaper sweeps and ten reads of the same id
 * column. A caller that loses the lock returns immediately and loses nothing,
 * because the holder is already draining the queue its jobs are in.
 */
const DRAIN_LOCK_KEY = 8_531_207;

/** 1min, 2min, 4min. Enough to ride out a quota blip without stalling a day. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 16) * 60_000;
}

type ClaimedJob = {
  id: string;
  connectionId: string;
  jobType: "append" | "update" | "delete";
  workLogId: string | null;
  attempts: number;
};

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
 * Ordered and filtered on (status, run_after) so the claim uses
 * `sync_jobs_claim_idx`. FOR UPDATE SKIP LOCKED means a second worker takes a
 * disjoint set rather than writing the same row to a sheet twice.
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
        ORDER BY ${syncJobs.runAfter}
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, connection_id AS "connectionId", job_type AS "jobType",
              work_log_id AS "workLogId", attempts
  `);
  return rows as unknown as ClaimedJob[];
}

/**
 * What a row needs, minus the note's final form.
 *
 * `workDone` is decided per connection by its visibility, so the entry carries
 * the raw note and the row builder settles it.
 */
type SheetEntry = Omit<SheetRow, "workDone"> & { notes: string };

/** The current state of every entry in the batch, read fresh rather than stored. */
async function loadEntries(
  workLogIds: string[],
): Promise<Map<string, SheetEntry>> {
  if (workLogIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: workLogs.id,
      workDate: workLogs.workDate,
      hours: workLogs.hours,
      notes: workLogs.internalNotes,
      status: workLogs.resultingStatus,
      developer: users.name,
      taskTitle: tasks.title,
      projectName: projects.name,
    })
    .from(workLogs)
    .innerJoin(projects, eq(workLogs.projectId, projects.id))
    .leftJoin(users, eq(workLogs.userId, users.id))
    .leftJoin(tasks, eq(workLogs.taskId, tasks.id))
    .where(inArray(workLogs.id, workLogIds));

  return new Map(
    rows.map((r) => [
      r.id,
      {
        date: r.workDate.toISOString().slice(0, 10),
        developer: r.developer ?? "",
        project: r.projectName,
        task: r.taskTitle ?? "General project work",
        hours: Number(r.hours).toFixed(2),
        notes: r.notes,
        status: r.status ?? "",
        workLogId: r.id,
      },
    ]),
  );
}

/**
 * Builds the row for an entry.
 *
 * `visibility` decides the note. A `shareable` sheet gets an empty Work Done
 * cell, so flipping a connection to shareable cannot retroactively expose notes
 * already written — only rows created afterwards change.
 */
function rowFor(
  entry: SheetEntry,
  visibility: "internal" | "shareable",
): string[] {
  return toCells({
    ...entry,
    workDone: visibility === "internal" ? entry.notes : "",
  });
}

/** A withdrawn entry keeps its row, at zero hours, marked as removed. */
function reversalRow(entry: SheetEntry): string[] {
  return toCells({
    ...entry,
    hours: "0.00",
    workDone: "",
    status: "Removed",
  });
}

/**
 * Reports how the group was disposed of, so the drain's counters mean something.
 *
 * A rate limit that will be retried is not a failure, and reporting it as one
 * makes the cron endpoint's output — the only thing watching this in
 * production — cry wolf.
 */
async function failJobs(
  jobs: ClaimedJob[],
  connectionId: string,
  err: unknown,
): Promise<{ retried: number; failed: number }> {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = isRetryableSheetsError(err);

  const retrying = jobs.filter((j) => retryable && j.attempts < MAX_ATTEMPTS);
  const exhausted = jobs.filter((j) => !retrying.includes(j));

  if (retrying.length > 0) {
    for (const job of retrying) {
      await db
        .update(syncJobs)
        .set({
          status: "queued",
          lastError: message,
          runAfter: new Date(Date.now() + backoffMs(job.attempts)),
        })
        .where(eq(syncJobs.id, job.id));
    }
    log.warn("sync.jobs.retrying", { count: retrying.length, err: message });
  }

  if (exhausted.length === 0) return { retried: retrying.length, failed: 0 };

  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "failed", lastError: message, finishedAt: new Date() })
      .where(inArray(syncJobs.id, exhausted.map((j) => j.id)));
    // The connection is marked broken so the project page says why, rather than
    // looking healthy while nothing reaches the sheet.
    await tx
      .update(sheetConnections)
      .set({ status: "error", errorMessage: message, updatedAt: new Date() })
      .where(eq(sheetConnections.id, connectionId));
  });

  log.error("sync.jobs.failed", {
    count: exhausted.length,
    connectionId,
    err: message,
  });

  await notifyAdmins(connectionId, message);
  return { retried: retrying.length, failed: exhausted.length };
}

/**
 * A permanently failed sync means a project's sheet is now silently stale, so it
 * becomes somebody's actionable inbox item rather than a log line.
 */
async function notifyAdmins(connectionId: string, message: string) {
  // Left join: a developer's sheet has no project, and an inner join would
  // silently drop the alert for exactly those failures.
  const [connection] = await db
    .select({
      projectId: sheetConnections.projectId,
      code: projects.code,
      person: users.name,
    })
    .from(sheetConnections)
    .leftJoin(projects, eq(sheetConnections.projectId, projects.id))
    .leftJoin(users, eq(sheetConnections.userId, users.id))
    .where(eq(sheetConnections.id, connectionId))
    .limit(1);

  const which = connection?.code ?? connection?.person ?? null;

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.globalRole, "admin"), eq(users.isActive, true)));

  for (const admin of admins) {
    await notify({
      userId: admin.id,
      kind: "sync_failed",
      title: `Work log sheet stopped syncing${which ? ` — ${which}` : ""}`,
      body: message,
      projectId: connection?.projectId ?? null,
      isActionable: true,
      dedupeKey: `sync_failed:${connectionId}`,
    });
  }
}

async function markDone(jobIds: string[], connectionId: string) {
  if (jobIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "done", finishedAt: new Date(), lastError: null })
      .where(inArray(syncJobs.id, jobIds));
    await tx
      .update(sheetConnections)
      .set({ lastSyncAt: new Date(), errorMessage: null })
      .where(eq(sheetConnections.id, connectionId));
  });
}

/** Everything for one sheet, in a fixed number of API calls. */
async function drainConnection(
  connection: typeof sheetConnections.$inferSelect,
  jobs: ClaimedJob[],
  entries: Map<string, SheetEntry>,
) {
  // One header read per connection per drain. A column inserted by hand would
  // otherwise send Hours quietly into the Status column, corrupting the sheet a
  // row at a time with nothing failing.
  const headers = await readHeaderRow(
    connection.spreadsheetId,
    connection.tabName,
  );
  const check = checkHeaders(headers);
  if (!check.ok) {
    throw new NonRetryableSheetError(
      `The sheet's columns have changed, so nothing was written. ${check.reason}`,
    );
  }
  if (connection.headerHash && check.hash !== connection.headerHash) {
    throw new NonRetryableSheetError(
      "The sheet's header row has changed since it was connected. Reconnect it to confirm the new layout.",
    );
  }

  const appends = jobs.filter((j) => j.jobType === "append");
  const corrections = jobs.filter((j) => j.jobType !== "append");

  // ---- appends: one call for the whole group ----
  const appendable = appends.filter((j) => j.workLogId && entries.has(j.workLogId));
  if (appendable.length > 0) {
    const rows = appendable.map((j) =>
      rowFor(entries.get(j.workLogId!)!, connection.visibility),
    );
    const rowNumbers = await appendRows(
      connection.spreadsheetId,
      connection.tabName,
      rows,
    );

    // Remember where each landed: the hint a later correction starts from.
    for (let i = 0; i < appendable.length; i++) {
      const rowNumber = rowNumbers[i];
      if (!rowNumber) continue;
      await db
        .insert(sheetRowLinks)
        .values({
          connectionId: connection.id,
          workLogId: appendable[i].workLogId!,
          rowNumber,
        })
        .onConflictDoUpdate({
          target: [sheetRowLinks.connectionId, sheetRowLinks.workLogId],
          set: { rowNumber },
        });
    }
  }

  // ---- corrections: one id-column read, one batched write ----
  if (corrections.length > 0) {
    const idColumn = await readIdColumn(
      connection.spreadsheetId,
      connection.tabName,
    );

    const ids = corrections.map((j) => j.workLogId).filter(Boolean) as string[];
    const hints = new Map(
      (
        await db
          .select({
            workLogId: sheetRowLinks.workLogId,
            rowNumber: sheetRowLinks.rowNumber,
          })
          .from(sheetRowLinks)
          .where(
            and(
              eq(sheetRowLinks.connectionId, connection.id),
              inArray(sheetRowLinks.workLogId, ids.length ? ids : [""]),
            ),
          )
      ).map((r) => [r.workLogId, r.rowNumber]),
    );

    const updates: { row: number; cells: string[] }[] = [];
    const repairs: { workLogId: string; rowNumber: number }[] = [];

    for (const job of corrections) {
      if (!job.workLogId) continue;
      const entry = entries.get(job.workLogId);
      if (!entry) continue;

      const row = locateRow(
        idColumn,
        job.workLogId,
        hints.get(job.workLogId) ?? null,
      );
      if (row === null) {
        // Somebody deleted the row by hand. Skipping is the only safe move:
        // writing to the remembered number would overwrite whatever is there now.
        log.warn("sync.row_missing", {
          connectionId: connection.id,
          workLogId: job.workLogId,
        });
        continue;
      }

      updates.push({
        row,
        cells:
          job.jobType === "delete"
            ? reversalRow(entry)
            : rowFor(entry, connection.visibility),
      });
      if (hints.get(job.workLogId) !== row) {
        repairs.push({ workLogId: job.workLogId, rowNumber: row });
      }
    }

    await updateRows(connection.spreadsheetId, connection.tabName, updates);

    for (const r of repairs) {
      await db
        .update(sheetRowLinks)
        .set({ rowNumber: r.rowNumber })
        .where(
          and(
            eq(sheetRowLinks.connectionId, connection.id),
            eq(sheetRowLinks.workLogId, r.workLogId),
          ),
        );
    }
  }
}

/** A sheet problem no amount of retrying fixes: stop and tell somebody. */
export class NonRetryableSheetError extends Error {
  readonly code = 400;
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableSheetError";
  }
}

export async function runSyncWorker(limit = BATCH_SIZE) {
  const [lock] = await db.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_lock(${DRAIN_LOCK_KEY}) AS locked`,
  );
  if (!(lock as unknown as { locked: boolean })?.locked) {
    return { skipped: "another drain is running" as const };
  }

  const startedAt = Date.now();
  try {
    const reclaimed = await reclaimStuckJobs();
    const jobs = await claimJobs(limit);
    if (jobs.length === 0)
      return { reclaimed, claimed: 0, done: 0, failed: 0, retried: 0, skipped: 0 };

    const entries = await loadEntries(
      [...new Set(jobs.map((j) => j.workLogId).filter(Boolean) as string[])],
    );

    const connections = new Map(
      (
        await db
          .select()
          .from(sheetConnections)
          .where(
            inArray(sheetConnections.id, [
              ...new Set(jobs.map((j) => j.connectionId)),
            ]),
          )
      ).map((c) => [c.id, c]),
    );

    const byConnection = new Map<string, ClaimedJob[]>();
    for (const job of jobs) {
      const list = byConnection.get(job.connectionId) ?? [];
      list.push(job);
      byConnection.set(job.connectionId, list);
    }

    let done = 0;
    let failed = 0;
    let retried = 0;
    let skipped = 0;

    for (const [connectionId, group] of byConnection) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        // Hand the rest back rather than being killed holding them.
        await db
          .update(syncJobs)
          .set({ status: "queued", runAfter: new Date() })
          .where(inArray(syncJobs.id, group.map((j) => j.id)));
        skipped += group.length;
        continue;
      }

      const connection = connections.get(connectionId);

      if (!connection || connection.status === "archived") {
        await db
          .update(syncJobs)
          .set({
            status: "done",
            finishedAt: new Date(),
            lastError: "Connection removed or archived; skipped.",
          })
          .where(inArray(syncJobs.id, group.map((j) => j.id)));
        skipped += group.length;
        continue;
      }

      if (connection.status === "paused") {
        // Paused is deliberate and temporary, so the work waits rather than
        // being dropped: the sheet gets the backlog when it resumes.
        await db
          .update(syncJobs)
          .set({
            status: "queued",
            runAfter: new Date(Date.now() + 15 * 60_000),
            lastError: "Connection paused; waiting.",
          })
          .where(inArray(syncJobs.id, group.map((j) => j.id)));
        skipped += group.length;
        continue;
      }

      try {
        await drainConnection(connection, group, entries);
        await markDone(group.map((j) => j.id), connectionId);
        done += group.length;
      } catch (err) {
        const outcome = await failJobs(group, connectionId, err);
        failed += outcome.failed;
        retried += outcome.retried;
      }
    }

    log.info("sync.drain", { reclaimed, claimed: jobs.length, done, failed, retried, skipped });
    return { reclaimed, claimed: jobs.length, done, failed, retried, skipped };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${DRAIN_LOCK_KEY})`);
  }
}
