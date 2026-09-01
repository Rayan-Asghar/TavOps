/**
 * Display formatting, in one place.
 *
 * Everything here is pinned to UTC, for the same reason the domain layer is
 * (see `business-time.ts`): the 18:00–02:00 PKT shift is 13:00–21:00 UTC and
 * never crosses a UTC midnight, so the UTC calendar date *is* the work day.
 * The previous per-page helpers omitted `timeZone` entirely, which rendered in
 * whatever zone the server happened to run in — so a Pakistan-based user on a
 * UTC host saw the wrong day for the first five hours of every local day, and
 * because it is server-rendered it never self-corrected.
 *
 * Pure and dependency-free, so it is unit-tested like `report-range.ts`.
 */

const EM_DASH = "—";

/** "Sep 01". The dateless case renders an em dash rather than an empty cell. */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return EM_DASH;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

/** "Sep 01, 2026" — for anything that can be more than a year old. */
export function fmtDateFull(d: Date | null | undefined): string {
  if (!d) return EM_DASH;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Sep 01, 09:30 PM" — the audit log's resolution. */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return EM_DASH;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "MONDAY · SEP 01", the shell's date line. */
export function fmtDayLabel(now: Date = new Date()): string {
  const day = now
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toUpperCase();
  const rest = now
    .toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    })
    .toUpperCase();
  return `${day} · ${rest}`;
}

/**
 * Relative age. Replaces two implementations that disagreed: the inbox floored
 * at "1 min ago" and never said "just now"; the review queue worked in whole
 * hours and called anything under an hour "just now". This keeps minute
 * resolution *and* the sub-minute case.
 */
export function timeAgo(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return EM_DASH;
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Hours, always to the same precision so columns line up. */
export function hrs(n: number, dp: 1 | 2 = 2): string {
  return n.toFixed(dp);
}

/** A ratio as a whole percentage. Null is "not applicable", not zero. */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? EM_DASH : `${Math.round(n * 100)}%`;
}

/** "$12,500" — whole dollars; cents are noise at agency contract sizes. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
