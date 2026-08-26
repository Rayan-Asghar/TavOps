import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sheetMappings, syncJobs, users } from "@/db/schema";
import {
  appendRow,
  updateRowCells,
  isRetryableSheetsError,
  type ColumnMap,
} from "./sheets";
import { notify } from "./notifications";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

/** 1min, 2min, 4min. Enough to ride out a quota blip without stalling a day. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 16) * 60_000;
}

type ClaimedJob = {
  id: string;
  mappingId: string;
  workLogId: string | null;
  attempts: number;
  payload: Record<string, unknown> | null;
};

/**
 * Claims a batch of due jobs atomically.
 *
 * FOR UPDATE SKIP LOCKED is what makes it safe to run this worker on a schedule
 * without a distributed lock: two overlapping invocations take disjoint sets of
 * rows rather than both writing the same row to the client's sheet twice.
 */
async function claimJobs(limit: number): Promise<ClaimedJob[]> {
  const rows = await db.execute<ClaimedJob>(sql`
    UPDATE sync_jobs
       SET status = 'running', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM sync_jobs
        WHERE status = 'pending'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, mapping_id AS "mappingId", work_log_id AS "workLogId",
              attempts, payload
  `);
  return rows as unknown as ClaimedJob[];
}

async function markSuccess(jobId: string, mappingId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "success", completedAt: new Date(), lastError: null })
      .where(eq(syncJobs.id, jobId));
    await tx
      .update(sheetMappings)
      .set({ lastSyncedAt: new Date() })
      .where(eq(sheetMappings.id, mappingId));
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
        status: "pending",
        lastError: message,
        nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
      })
      .where(eq(syncJobs.id, job.id));
    return;
  }

  await db
    .update(syncJobs)
    .set({ status: "failed", lastError: message })
    .where(eq(syncJobs.id, job.id));

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
      body: `Job ${job.id} gave up after ${job.attempts} attempts: ${message}`,
      isActionable: true,
      dedupeKey: `sync_failed:${job.mappingId}`,
    });
  }
}

export async function runSyncWorker(limit = BATCH_SIZE) {
  const jobs = await claimJobs(limit);
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const [mapping] = await db
        .select()
        .from(sheetMappings)
        .where(eq(sheetMappings.id, job.mappingId))
        .limit(1);

      if (!mapping || !mapping.isEnabled) {
        await db
          .update(syncJobs)
          .set({
            status: "success",
            completedAt: new Date(),
            lastError: "Mapping removed or disabled; skipped.",
          })
          .where(eq(syncJobs.id, job.id));
        continue;
      }

      const p = (job.payload ?? {}) as Record<string, unknown>;

      let workedByName = "";
      if (p.workedBy) {
        const [u] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, String(p.workedBy)))
          .limit(1);
        workedByName = u?.name ?? "";
      }

      const values: Record<string, string> = {
        date: new Date(String(p.workDate ?? Date.now()))
          .toISOString()
          .slice(0, 10),
        taskTitle: String(p.taskTitle ?? ""),
        developer: workedByName,
        hours: String(p.hours ?? ""),
        notes: String(p.notes ?? ""),
        status: String(p.status ?? ""),
      };

      const columnMap = mapping.columnMap as ColumnMap;
      const rowRef = p.sheetRowRef ? Number(p.sheetRowRef) : NaN;

      if (mapping.mode === "update" && Number.isFinite(rowRef)) {
        await updateRowCells({
          spreadsheetId: mapping.spreadsheetId,
          sheetName: mapping.sheetName,
          rowNumber: rowRef,
          columnMap,
          values,
        });
      } else {
        // Update-mode tasks with no known row fall back to append rather than
        // guessing a row number and overwriting an unrelated one.
        await appendRow({
          spreadsheetId: mapping.spreadsheetId,
          sheetName: mapping.sheetName,
          columnMap,
          values,
        });
      }

      await markSuccess(job.id, job.mappingId);
      succeeded++;
    } catch (err) {
      await markFailure(job, err);
      failed++;
    }
  }

  return { claimed: jobs.length, succeeded, failed };
}
