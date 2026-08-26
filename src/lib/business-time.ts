/**
 * SLA clocks run on business hours, not wall-clock hours.
 *
 * A blocker reported at 5pm Friday is not "24 hours overdue" on Saturday
 * evening. Escalating on raw elapsed time is the fastest way to train people
 * to ignore the alerts, so every deadline in the system is computed here.
 */

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const HOURS_PER_DAY = WORK_END_HOUR - WORK_START_HOUR;

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
