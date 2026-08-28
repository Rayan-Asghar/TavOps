/**
 * SLA clocks run on business hours, not wall-clock hours.
 *
 * A blocker reported at the end of Friday's shift is not "24 hours overdue" on
 * Saturday evening. Escalating on raw elapsed time is the fastest way to train
 * people to ignore the alerts, so every deadline in the system is computed here.
 *
 * ## Why these hours are in UTC, and why that works
 *
 * Tavren works 18:00–02:00 PKT (UTC+5) to overlap US client hours, which is
 * 13:00–21:00 UTC. That window is the reason this file can stay on plain UTC
 * arithmetic instead of needing a timezone library:
 *
 *   - The shift does NOT cross a UTC midnight, even though it crosses a
 *     Pakistani one. Monday's shift is 13:00–21:00 UTC on Monday, full stop.
 *   - So `getUTCDay()` weekend detection lines up exactly with Monday–Friday
 *     night shifts. A shift that ends 02:00 Saturday PKT is still Friday in UTC
 *     and is correctly treated as a working day.
 *   - And every work log from one shift lands on a single UTC calendar date,
 *     so `work_date` groups a night's work the way a person would expect.
 *
 * If the shift ever moves such that it straddles 00:00 UTC, this whole file
 * has to become timezone-aware — the day-boundary assumption above is what
 * keeps it simple, and it is not incidental.
 */

/** 18:00 PKT. */
const WORK_START_HOUR = 13;
/** 02:00 PKT the following morning — still the same UTC day. */
const WORK_END_HOUR = 21;

/** Length of one shift. Exported so "one working day" has a single definition. */
export const HOURS_PER_DAY = WORK_END_HOUR - WORK_START_HOUR;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function startOfWorkday(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(WORK_START_HOUR, 0, 0, 0);
  return out;
}

function nextWorkdayStart(d: Date): Date {
  const out = startOfWorkday(d);
  do {
    out.setUTCDate(out.getUTCDate() + 1);
  } while (isWeekend(out));
  return out;
}

/** Clamps a timestamp forward to the next moment inside working hours. */
function normalizeIntoWorkHours(from: Date): Date {
  const cursor = new Date(from);
  if (isWeekend(cursor)) return nextWorkdayStart(cursor);
  if (cursor.getUTCHours() < WORK_START_HOUR) return startOfWorkday(cursor);
  if (cursor.getUTCHours() >= WORK_END_HOUR) return nextWorkdayStart(cursor);
  return cursor;
}

function endOfWorkday(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(WORK_END_HOUR, 0, 0, 0);
  return out;
}

function prevWorkdayEnd(d: Date): Date {
  const out = endOfWorkday(d);
  do {
    out.setUTCDate(out.getUTCDate() - 1);
  } while (isWeekend(out));
  return out;
}

/** Mirror of normalizeIntoWorkHours, clamping *backwards* instead. */
function normalizeBackIntoWorkHours(from: Date): Date {
  const cursor = new Date(from);
  if (isWeekend(cursor)) return prevWorkdayEnd(cursor);
  if (cursor.getUTCHours() >= WORK_END_HOUR) return endOfWorkday(cursor);
  if (cursor.getUTCHours() < WORK_START_HOUR) return prevWorkdayEnd(cursor);
  return cursor;
}

/**
 * Walks backwards through working hours.
 *
 * Kept as a real implementation rather than negating the forward walk: a plain
 * `remaining > 0` loop silently no-ops on negative input and returns a cutoff in
 * the *future*, which made every in-progress task look stale.
 */
function subtractBusinessHours(from: Date, hours: number): Date {
  let cursor = normalizeBackIntoWorkHours(from);
  let remaining = hours;

  while (remaining > 0) {
    const dayStart = startOfWorkday(cursor);
    const availableHours =
      (cursor.getTime() - dayStart.getTime()) / 3_600_000;

    if (remaining <= availableHours) {
      cursor = new Date(cursor.getTime() - remaining * 3_600_000);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = prevWorkdayEnd(cursor);
    }
  }

  return cursor;
}

export function addBusinessHours(from: Date, hours: number): Date {
  if (hours < 0) return subtractBusinessHours(from, -hours);
  if (hours === 0) return normalizeIntoWorkHours(from);

  let cursor = normalizeIntoWorkHours(from);
  let remaining = hours;

  while (remaining > 0) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(WORK_END_HOUR, 0, 0, 0);

    const availableMs = endOfDay.getTime() - cursor.getTime();
    const availableHours = availableMs / 3_600_000;

    if (remaining <= availableHours) {
      cursor = new Date(cursor.getTime() + remaining * 3_600_000);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = nextWorkdayStart(cursor);
    }
  }

  return cursor;
}

export function businessHoursBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let cursor = normalizeIntoWorkHours(start);
  let total = 0;

  while (cursor < end) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(WORK_END_HOUR, 0, 0, 0);
    const slice = Math.min(endOfDay.getTime(), end.getTime()) - cursor.getTime();
    if (slice > 0) total += slice / 3_600_000;
    cursor = nextWorkdayStart(cursor);
  }

  return Math.max(0, total);
}

export function addBusinessDays(from: Date, days: number): Date {
  return addBusinessHours(from, days * HOURS_PER_DAY);
}
