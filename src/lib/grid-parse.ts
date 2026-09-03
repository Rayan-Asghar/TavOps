/**
 * Reading what somebody typed into a grid cell.
 *
 * Pure, and deliberately strict about the two formats that are genuinely
 * ambiguous. Everything here works in UTC, like the rest of the app: the
 * 18:00–02:00 PKT shift is 13:00–21:00 UTC and never crosses a UTC midnight, so
 * the UTC calendar date is the work day. A bare `new Date("2026-08-01")` is
 * parsed as UTC but *formatted* locally, which shifts the day for anyone west
 * of it — hence the explicit `T00:00:00.000Z` throughout.
 */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Hours as the column stores them: two decimals, never a float in disguise. */
export function formatHours(value: string | number): string {
  return Number(value).toFixed(2);
}

/**
 * Hours from a cell.
 *
 * Clock notation is refused rather than guessed at: `8:30` means eight and a
 * half hours to a person and would silently become 8.30 — a twelve-minute
 * error on every entry that used it.
 */
export function parseHours(raw: string): ParseResult<number> {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Hours are needed." };
  if (/^\d+\s*:\s*\d+$/.test(text)) {
    return { ok: false, error: "Write 8.5 rather than 8:30." };
  }
  if (!/^\d*\.?\d+$/.test(text)) {
    return { ok: false, error: "Hours should be a number, like 6.5." };
  }

  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Hours should be a number, like 6.5." };
  if (n < 0.01) return { ok: false, error: "Log at least a minute." };
  if (n > 24) return { ok: false, error: "That is more than a day." };
  return { ok: true, value: n };
}

/**
 * A date from a cell, as `YYYY-MM-DD`.
 *
 * Two formats are accepted: ISO, and the `Sat, 01 Aug 2026` the sheet writes —
 * because the workflow this grid exists for is copying a month out of the
 * project's sheet, fixing it, and pasting it back. `01/08/2026` is refused
 * outright: it is the first of August to half the world and the eighth of
 * January to the other half, and picking one silently is how a month of
 * timesheets ends up wrong.
 */
export function parseGridDate(raw: string): ParseResult<string> {
  const text = raw.trim();
  if (!text) return { ok: false, error: "A date is needed." };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return checkDate(+iso[1], +iso[2], +iso[3], text);

  // `Sat, 01 Aug 2026` — and the same without the weekday.
  const sheet = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text);
  if (sheet) {
    const month = MONTHS.findIndex(
      (m) => m.toLowerCase() === sheet[2].slice(0, 3).toLowerCase(),
    );
    if (month === -1) return { ok: false, error: "That is not a month." };
    const y = +sheet[3];
    const d = +sheet[1];
    return checkDate(y, month + 1, d, `${y}-${pad(month + 1)}-${pad(d)}`);
  }

  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(text)) {
    return {
      ok: false,
      error: "Write the date as 2026-08-01 — 01/08/2026 is ambiguous.",
    };
  }
  return { ok: false, error: "Write the date as 2026-08-01." };
}

function checkDate(
  y: number,
  m: number,
  d: number,
  iso: string,
): ParseResult<string> {
  if (m < 1 || m > 12) return { ok: false, error: "That is not a month." };
  const asDate = new Date(Date.UTC(y, m - 1, d));
  // Round-tripping catches the 31st of a 30-day month, which Date would
  // otherwise roll forward into the next one without complaint.
  if (
    asDate.getUTCFullYear() !== y ||
    asDate.getUTCMonth() !== m - 1 ||
    asDate.getUTCDate() !== d
  ) {
    return { ok: false, error: "That day is not on the calendar." };
  }
  return { ok: true, value: iso.length === 10 ? iso : `${y}-${pad(m)}-${pad(d)}` };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `Sat, 01 Aug 2026`, the way the sheet writes it. */
export function formatGridDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
