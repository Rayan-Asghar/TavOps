/**
 * Whether a periodic job is due.
 *
 * Pure, with no database access, for the reason `digest-format.ts` is split
 * from `digest.ts`: this is the decision worth testing exhaustively, and its
 * awkward cases are all about clocks and calendars rather than SQL.
 *
 * The server owns this decision entirely. A browser heartbeat says only
 * "somebody is here"; it never names a job, never sends a timestamp, and never
 * concludes that anything should run. Five open laptops therefore produce one
 * run an hour, not five — see `src/server/scheduler.ts` for the lock that makes
 * the claim atomic.
 */

export type JobName = "sweeps" | "sync" | "digest";

export type JobDefinition =
  /** Runs when this much time has passed since the last run. */
  | { name: JobName; kind: "interval"; everyMs: number }
  /**
   * Runs at most once per UTC day, and only at or after this hour. A missed
   * day is NOT made up: a digest about Tuesday, delivered on Thursday, is
   * noise dressed as a report.
   */
  | { name: JobName; kind: "daily"; atHourUtc: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Cadences match what an external cron would have been told to do, so a host
 * that later gains real cron behaves identically.
 *
 * `sync` is far more frequent than the others because it is a BACKSTOP, not the
 * main path: `scheduleDrain()` already pushes a sheet write straight after the
 * response. This exists for jobs stranded by a crash or a deploy mid-drain,
 * which `reclaimStuckJobs` only rescues once something runs.
 */
export const SCHEDULE: Record<JobName, JobDefinition> = {
  sweeps: { name: "sweeps", kind: "interval", everyMs: HOUR },
  sync: { name: "sync", kind: "interval", everyMs: 3 * MINUTE },
  digest: { name: "digest", kind: "daily", atHourUtc: 13 },
};

/** Same UTC calendar day. Compared as a string so no arithmetic can drift. */
function sameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

export function isDue(
  def: JobDefinition,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  if (def.kind === "interval") {
    if (!lastRunAt) return true;
    // >= so a job whose interval has exactly elapsed runs rather than waiting
    // for the next tick, which on a 5-minute heartbeat would cost 5 minutes.
    return now.getTime() - lastRunAt.getTime() >= def.everyMs;
  }

  // Before its hour, a daily job is never due — including the very first time.
  // Otherwise the first person to open the app at 03:00 sends the digest.
  if (now.getUTCHours() < def.atHourUtc) return false;

  if (!lastRunAt) return true;
  return !sameUtcDay(lastRunAt, now);
}

/** Every job that is due, in a fixed order so runs are reproducible. */
export function dueJobs(
  lastRuns: Partial<Record<JobName, Date | null>>,
  now: Date,
): JobName[] {
  const order: JobName[] = ["sweeps", "sync", "digest"];
  return order.filter((n) => isDue(SCHEDULE[n], lastRuns[n] ?? null, now));
}
