/**
 * Elapsed time is always derived, never ticked.
 *
 * A stored counter that a client increments loses whatever happened while the
 * laptop was shut, the tab was killed or the server restarted. Deriving it from
 * `accumulatedSeconds` (banked at each pause) plus the current running segment
 * means the number survives all three.
 */

export type TimerShape = {
  status: "running" | "paused" | "completed";
  accumulatedSeconds: number;
  resumedAt: Date | string | null;
  adjustedSeconds?: number | null;
};

export function elapsedSeconds(s: TimerShape, nowMs: number = Date.now()): number {
  if (s.status === "completed") {
    return s.adjustedSeconds ?? s.accumulatedSeconds;
  }
  if (s.status === "running" && s.resumedAt) {
    const resumed =
      typeof s.resumedAt === "string" ? new Date(s.resumedAt) : s.resumedAt;
    return s.accumulatedSeconds + Math.max(0, Math.floor((nowMs - resumed.getTime()) / 1000));
  }
  return s.accumulatedSeconds;
}

/** "5h 47m" — the form people actually read. Under an hour drops to minutes. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "01:23:45" — the live stopwatch readout. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Billable hours, rounded to the nearest minute so 5h 47m is not 5.78333. */
export function secondsToHours(totalSeconds: number): number {
  return Math.round((totalSeconds / 3600) * 60) / 60;
}

/** A timer running this long is almost certainly one somebody forgot to stop. */
export const RUNAWAY_TIMER_HOURS = 12;
