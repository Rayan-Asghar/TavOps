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
  formatSheetDate,
  locateRow,
  monthTabName,
  toCells,
} from "@/lib/sheet-template";
import {
  appendRows,
  ensureMonthTab,
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
 * What a row needs.
 *
 * `workDate` stays a Date because it decides which month's tab the entry belongs
 * in as well as how the cell reads. The note is carried raw: whether it reaches
 * the sheet at all depends on the connection's visibility.
 */
type SheetEntry = {
  workLogId: string;
  workDate: Date;
  hours: string;
  notes: string;
};

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
        workLogId: r.id,
        workDate: r.workDate,
        hours: Number(r.hours).toFixed(2),
        notes: r.notes,
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
    date: formatSheetDate(entry.workDate),
    hours: entry.hours,
    workDone: visibility === "internal" ? entry.notes : "",
    workLogId: entry.workLogId,
  });
}

/**
 * A withdrawn entry keeps its row, at zero hours, saying so.
 *
 * There is no status column on this layout, so the note carries it — a blank row
 * would read as an entry somebody forgot to fill in rather than one withdrawn on
 * purpose, and the hours total would still be right either way.
 */
function reversalRow(entry: SheetEntry): string[] {
  return toCells({
    date: formatSheetDate(entry.workDate),
    hours: "0.00",
    workDone: "— removed —",
    workLogId: entry.workLogId,
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

/**
 * Everything for one sheet, grouped by the month each entry belongs in.
 *
 * The team keeps a tab per month, so a batch that straddles the first of the
 * month touches two tabs. Within a tab the cost is fixed regardless of how many
 * entries it carries: one header read, one id-column read, one append, one
 * batched update.
 */
async function drainConnection(
  connection: typeof sheetConnections.$inferSelect,
  label: string,
  jobs: ClaimedJob[],
  entries: Map<string, SheetEntry>,
) {
  // Route by the entry's own work date, not by today: a correction filed in
  // September to August's work belongs in August's tab.
  const byMonth = new Map<string, ClaimedJob[]>();
  for (const job of jobs) {
    const entry = job.workLogId ? entries.get(job.workLogId) : undefined;
    if (!entry) continue;
    const tab = monthTabName(entry.workDate);
    const list = byMonth.get(tab) ?? [];
    list.push(job);
    byMonth.set(tab, list);
  }

  for (const [tabName, group] of byMonth) {
    await drainMonth(connection, label, tabName, group, entries);
  }
}

async function drainMonth(
  connection: typeof sheetConnections.$inferSelect,
  label: string,
  tabName: string,
  jobs: ClaimedJob[],
  entries: Map<string, SheetEntry>,
) {
  // Creates the month's tab, banner and formulas if this is its first entry.
  // Nobody has to remember on the first of the month.
  await ensureMonthTab(connection.spreadsheetId, tabName, label);

  // A column inserted by hand would otherwise send Hours quietly into the Notes
  // column, corrupting the sheet a row at a time with nothing failing.
  const headers = await readHeaderRow(connection.spreadsheetId, tabName);
  const check = checkHeaders(headers);
  if (!check.ok) {
    throw new NonRetryableSheetError(
      `The columns on "${tabName}" have changed, so nothing was written. ${check.reason}`,
    );
  }
  if (connection.headerHash && check.hash !== connection.headerHash) {
    throw new NonRetryableSheetError(
      `The header row on "${tabName}" has changed since this sheet was connected. Reconnect it to confirm the new layout.`,
    );
  }

  const appends = jobs.filter((j) => j.jobType === "append");
  const corrections = jobs.filter((j) => j.jobType !== "append");

  // ---- appends: one call for the whole group ----
  const appendable = appends.filter(
    (j) => j.workLogId && entries.has(j.workLogId),
  );
  if (appendable.length > 0) {
    const rows = appendable.map((j) =>
      rowFor(entries.get(j.workLogId!)!, connection.visibility),
    );
    const rowNumbers = await appendRows(
      connection.spreadsheetId,
      tabName,
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
    const idColumn = await readIdColumn(connection.spreadsheetId, tabName);

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
        // Either a human deleted the row, or the entry's date was moved into a
        // different month and its old row is in another tab. Skipping is the
        // only safe move: writing to the remembered number would overwrite
        // whatever now sits there.
        log.warn("sync.row_missing", {
          connectionId: connection.id,
          tabName,
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

    await updateRows(connection.spreadsheetId, tabName, updates);

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

    // The label heads column B and titles a new month's tab: what the sheet is
    // about. A project's name for a project sheet, a person's for theirs.
    const connectionRows = await db
      .select({
        connection: sheetConnections,
        projectName: projects.name,
        personName: users.name,
      })
      .from(sheetConnections)
      .leftJoin(projects, eq(sheetConnections.projectId, projects.id))
      .leftJoin(users, eq(sheetConnections.userId, users.id))
      .where(
        inArray(sheetConnections.id, [
          ...new Set(jobs.map((j) => j.connectionId)),
        ]),
      );

    const connections = new Map(
      connectionRows.map((r) => [r.connection.id, r.connection]),
    );
    const labels = new Map(
      connectionRows.map((r) => [
        r.connection.id,
        r.projectName ?? r.personName ?? "Work log",
      ]),
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
        await drainConnection(
          connection,
          labels.get(connectionId) ?? "Work log",
          group,
          entries,
        );
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
