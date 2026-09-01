/**
 * The reporting window.
 *
 * Pure, and separate from `server/reports.ts`, so it can be tested without a
 * database — the same split as `digest.ts` and `digest-format.ts`. The page and
 * the CSV export both parse through here, so a link and its export always cover
 * the same days.
 */

export type DateRange = { from: Date; to: Date };

/** Longest window we will build a report for, in days. */
const MAX_DAYS = 400;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The calendar month containing `now` — what an agency invoices on. */
export function defaultRange(now = new Date()): DateRange {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  return { from, to };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reads a range off query parameters, falling back to the current month.
 *
 * Invalid values fall back rather than erroring: a report page reached from a
 * hand-edited URL should show something, not a stack trace.
 *
 * A value that is present but unparseable discards BOTH ends. Keeping the good
 * half and defaulting the other produces a window matching neither what was
 * asked for nor the default — a report silently covering the wrong days is
 * worse than one obviously covering this month. An absent end just defaults,
 * so `?from=2026-08-01` still means what it looks like.
 *
 * Reversed ranges are swapped, and the window is capped so a typo in the year
 * cannot ask for a decade of rows.
 */
export function parseRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now = new Date(),
): DateRange {
  const fallback = defaultRange(now);
  const given = (v: string | null | undefined) => !!v && v.length > 0;
  const parsedFrom = parseDate(from);
  const parsedTo = parseDate(to);

  if ((given(from) && !parsedFrom) || (given(to) && !parsedTo)) return fallback;

  let start = parsedFrom ?? fallback.from;
  let end = parsedTo ?? fallback.to;

  if (end < start) [start, end] = [end, start];

  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_DAYS) {
    end = new Date(start.getTime() + (MAX_DAYS - 1) * 86_400_000);
  }
  return { from: start, to: end };
}

/** "1–30 Sep 2026", or the full form when the range spans months. */
export function formatRange({ from, to }: DateRange): string {
  const sameMonth =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth();
  const month = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  if (sameMonth) {
    return `${from.getUTCDate()}–${to.getUTCDate()} ${month(to)} ${to.getUTCFullYear()}`;
  }
  const part = (d: Date) =>
    `${d.getUTCDate()} ${month(d)} ${d.getUTCFullYear()}`;
  return `${part(from)} – ${part(to)}`;
}
