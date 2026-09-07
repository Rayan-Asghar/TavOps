import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { log } from "@/lib/logger";
import {
  SCHEDULE,
  isDue,
  type JobName,
} from "@/lib/job-schedule";
import { runAllSweeps } from "./sweeps";
import { runSyncWorker } from "./sync-worker";
import { buildDigest, renderDigest } from "./digest";
import { deliver } from "./webhooks";

/**
 * The in-app scheduler.
 *
 * TavrenOPS has no host and therefore no cron, and every automation it is built
 * around was a URL nobody called. The app is open on a team machine through the
 * working day, so that browser is used as a CLOCK SOURCE — and only that.
 *
 * The division of labour is the whole design:
 *
 *   the browser  says "somebody is here", and nothing else. It never names a
 *                job, never sends a timestamp, and never concludes that
 *                anything should run.
 *   the server   reads job_runs, decides what is due, and claims it.
 *
 * So five open laptops produce one run an hour rather than five, and a tampered
 * client can at most cause the server to look at a table and find nothing due.
 * The heartbeat endpoint is session-authenticated; CRON_SECRET is never exposed
 * to a browser, and the heartbeat is not a call into /api/cron/*.
 *
 * This does not replace an external scheduler. The cron routes keep their
 * contract — bearer secret, run unconditionally, because deciding the time is
 * the caller's job — and they record their runs here too, so a host with both
 * does the work once.
 */

/** Distinct key per job, in the space the old sync drain lock (8_531_207) sat in. */
const LOCK_KEYS: Record<JobName, number> = {
  sweeps: 8_531_301,
  sync: 8_531_302,
  digest: 8_531_303,
};

/**
 * A host with real cron sets this to "off" and the app stops scheduling itself.
 * Checked on the server, so a stale browser tab polling an old build cannot
 * keep it alive.
 */
export function inAppSchedulerEnabled(): boolean {
  return (process.env.IN_APP_SCHEDULER ?? "on").toLowerCase() !== "off";
}

const RUNNERS: Record<JobName, () => Promise<Record<string, unknown>>> = {
  sweeps: async () => ({ ...(await runAllSweeps()) }),
  sync: async () => ({ ...(await runSyncWorker()) }),
  digest: async () => {
    const digest = await buildDigest();
    // `deliver` already no-ops without DIGEST_WEBHOOK_URLS, but claiming the
    // day's run and then delivering nothing would mark the digest done and
    // suppress it for the rest of the day. Checked before the claim instead.
    return { ...(await deliver(renderDigest(digest))) };
  },
};

/** A digest with nowhere to go is not due; it is unconfigured. */
function configured(job: JobName): boolean {
  if (job !== "digest") return true;
  return (process.env.DIGEST_WEBHOOK_URLS ?? "").trim().length > 0;
}

/**
 * Takes the job if it is genuinely due, atomically.
 *
 * `pg_try_advisory_xact_lock` rather than the `pg_try_advisory_lock` /
 * `pg_advisory_unlock` pair used in sync-worker.ts. A session-level lock is
 * held by a CONNECTION, and `db` is a pool: the unlock statement can be handed
 * a different connection than the lock was, in which case it releases nothing
 * and the lock leaks until that connection is recycled. The transaction-scoped
 * variant is released by the COMMIT itself, so it cannot be orphaned. (The same
 * hazard existed in sync-worker's drain lock; it turned out to be unfixable
 * behind a transaction pooler and that lock has since been removed entirely —
 * see the comment where DRAIN_LOCK_KEY used to be.)
 *
 * Due-ness is re-read INSIDE the lock. That is the step that makes concurrent
 * heartbeats safe: the loser waits, re-reads the row the winner just stamped,
 * finds the job no longer due, and does nothing.
 *
 * The claim stamps `last_run_at` BEFORE the work runs. A run that starts and
 * crashes must still count as "attempted at 10:00", or every heartbeat for the
 * next hour would retry a job that reliably dies and the log would fill with it.
 */
async function claim(
  job: JobName,
  now: Date,
  source: "heartbeat" | "cron",
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${LOCK_KEYS[job]}) AS locked`,
    );
    if (!(lock as unknown as { locked: boolean })?.locked) return false;

    const [row] = await tx
      .select({ lastRunAt: jobRuns.lastRunAt })
      .from(jobRuns)
      .where(eq(jobRuns.job, job))
      .limit(1);

    if (!isDue(SCHEDULE[job], row?.lastRunAt ?? null, now)) return false;

    await tx
      .insert(jobRuns)
      .values({
        job,
        lastRunAt: now,
        lastStatus: "running",
        lastSource: source,
        lastError: null,
        runs: 1,
      })
      .onConflictDoUpdate({
        target: jobRuns.job,
        set: {
          lastRunAt: now,
          lastStatus: "running",
          lastSource: source,
          lastError: null,
          runs: sql`${jobRuns.runs} + 1`,
          updatedAt: new Date(),
        },
      });

    return true;
  });
}

async function finish(
  job: JobName,
  status: "ok" | "error",
  ms: number,
  error?: unknown,
) {
  await db
    .update(jobRuns)
    .set({
      lastStatus: status,
      lastError:
        error === undefined
          ? null
          : error instanceof Error
            ? error.message
            : String(error),
      lastMs: ms,
      updatedAt: new Date(),
    })
    .where(eq(jobRuns.job, job));
}

export type SchedulerOutcome = {
  ran: JobName[];
  skipped: JobName[];
  failed: JobName[];
};

/**
 * Runs whatever is due. Safe to call from every heartbeat, from every open
 * browser, concurrently.
 */
export async function runDueJobs(
  source: "heartbeat" | "cron" = "heartbeat",
  now: Date = new Date(),
): Promise<SchedulerOutcome> {
  const out: SchedulerOutcome = { ran: [], skipped: [], failed: [] };
  if (!inAppSchedulerEnabled()) return out;

  const names: JobName[] = ["sweeps", "sync", "digest"];

  // Read once, so an obviously-not-due job costs no lock attempt at all. The
  // authoritative check still happens inside the lock; this is only triage.
  const rows = await db
    .select({ job: jobRuns.job, lastRunAt: jobRuns.lastRunAt })
    .from(jobRuns)
    .where(inArray(jobRuns.job, names));
  const lastRuns = new Map(rows.map((r) => [r.job, r.lastRunAt]));

  for (const job of names) {
    if (!configured(job)) continue;
    if (!isDue(SCHEDULE[job], lastRuns.get(job) ?? null, now)) continue;

    if (!(await claim(job, now, source))) {
      // Either another caller holds the lock, or it already ran between the
      // triage read and here. Both mean: not ours, say nothing.
      out.skipped.push(job);
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await RUNNERS[job]();
      const ms = Date.now() - startedAt;
      await finish(job, "ok", ms);
      out.ran.push(job);
      log.info("scheduler.job.done", { job, source, ms, ...result });
    } catch (err) {
      const ms = Date.now() - startedAt;
      await finish(job, "error", ms, err);
      out.failed.push(job);
      // Never rethrown: one failing job must not stop the others, and the
      // caller is a fire-and-forget heartbeat with nobody to report to.
      log.error("scheduler.job.failed", { job, source, ms, err });
    }
  }

  return out;
}

/**
 * Records a run the cron routes performed on their own authority.
 *
 * Those routes deliberately do NOT consult the schedule — an external scheduler
 * decides the time, and second-guessing it would make a misconfigured crontab
 * silently do nothing. But they stamp the row, so on a host that has both real
 * cron and open browsers the heartbeat finds the job not due and the work
 * happens once rather than twice.
 */
export async function recordCronRun(
  job: JobName,
  status: "ok" | "error",
  ms: number,
  error?: unknown,
): Promise<void> {
  const message =
    error === undefined
      ? null
      : error instanceof Error
        ? error.message
        : String(error);

  await db
    .insert(jobRuns)
    .values({
      job,
      lastRunAt: new Date(),
      lastStatus: status,
      lastError: message,
      lastSource: "cron",
      lastMs: ms,
      runs: 1,
    })
    .onConflictDoUpdate({
      target: jobRuns.job,
      set: {
        lastRunAt: new Date(),
        lastStatus: status,
        lastError: message,
        lastSource: "cron",
        lastMs: ms,
        runs: sql`${jobRuns.runs} + 1`,
        updatedAt: new Date(),
      },
    });
}
