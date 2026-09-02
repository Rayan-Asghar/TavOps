import { createHash } from "node:crypto";

/**
 * The Tavren work-log sheet layout.
 *
 * Modelled on the tracker the team already keeps by hand, so a sheet Tavren
 * fills looks like the ones they are used to reading: a title, a summary strip
 * whose totals are live formulas, then the log itself.
 *
 * The header is therefore NOT row 1. Everything that addresses the sheet has to
 * go through the constants here rather than assuming a row, which is the whole
 * reason they live in one place.
 *
 * Pure and in `lib/` so the rules are testable: a `"use server"` module may only
 * export async functions, and `server/` modules import `@/db`, which needs a
 * live connection string at import time.
 */

export const TEMPLATE_VERSION = 2;

/** The banner and summary block sit above the log. */
export const HEADER_ROW = 8;
export const FIRST_DATA_ROW = HEADER_ROW + 1;

/**
 * Column F holds the work log's uuid and is what actually addresses a row.
 * Hidden in the sheet, but present: a person sorting or inserting rows moves
 * every row number, and this is what survives that.
 */
export const ID_COLUMN = "F";

/** The range a full row occupies, for appends. */
export const ROW_RANGE = `A${HEADER_ROW}:F`;

/**
 * Column B is a label, not data.
 *
 * On the team's own sheets it carries the project's name and every cell beneath
 * it is empty — it says what the sheet is about rather than repeating itself on
 * every line. Tavren writes the heading and then leaves the column alone.
 */
export const LABEL_COLUMN_INDEX = 1;

export const TEMPLATE_HEADERS = [
  "Date",
  "", // the project label, filled in per sheet
  "Hours",
  "Notes — Work Done",
  "Link (if any)",
  "Work Log ID",
] as const;

/** Columns whose heading is fixed, by index. B is the sheet's own label. */
const FIXED_HEADERS: { index: number; text: string }[] = TEMPLATE_HEADERS.map(
  (text, index) => ({ index, text }),
).filter((h) => h.index !== LABEL_COLUMN_INDEX);

export type SheetRow = {
  date: string;
  hours: string;
  workDone: string;
  workLogId: string;
};

/**
 * One row, in column order.
 *
 * B (the label) and E (Link) are written as empty strings rather than skipped:
 * an append positions values by offset from the start of the range, so a gap
 * would shift everything after it one column left. They are the team's to fill.
 */
export function toCells(row: SheetRow): string[] {
  return [row.date, "", row.hours, row.workDone, "", row.workLogId];
}

/**
 * `Sat, 01 Aug 2026` — the format the team's own sheets use.
 *
 * Built from UTC parts rather than a locale string with a timezone, because a
 * Tavren shift never crosses a UTC midnight and the work date is already the
 * calendar day the team means.
 */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatSheetDate(d: Date): string {
  const day = DAYS[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${day}, ${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `August 2026` — a month's tab name, and the key that decides where an entry goes. */
export function monthTabName(d: Date): string {
  return `${FULL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The rows above the log: title, blank, summary headings, live totals.
 *
 * The totals are formulas rather than values Tavren maintains. A number written
 * once is wrong the moment anything below it changes, and nobody would know —
 * a formula is right by construction and keeps working if somebody edits the
 * sheet by hand.
 */
export function bannerRows(monthLabel: string, projectLabel: string): string[][] {
  const first = FIRST_DATA_ROW;
  return [
    [`TAVREN — ${monthLabel.toUpperCase()} WORK LOG`],
    ["Track daily project work, hours completed, notes, and supporting links."],
    [],
    [],
    ["MONTH", "TOTAL HOURS", "DAYS LOGGED", "PROJECT ENTRIES"],
    [
      monthLabel,
      `=TEXT(SUM(C${first}:C),"0.00")&" hrs"`,
      `=COUNTUNIQUE(A${first}:A)`,
      `=COUNTA(A${first}:A)`,
    ],
    [],
    ["Date", projectLabel, "Hours", "Notes — Work Done", "Link (if any)", "Work Log ID"],
  ];
}

export function headerHash(headers: readonly string[]): string {
  // Column B is the sheet's own label and differs per sheet by design, so it is
  // excluded — including it would make every sheet's hash unique and the drift
  // check meaningless.
  const normalised = FIXED_HEADERS.map(
    (h) => (headers[h.index] ?? "").trim().toLowerCase(),
  ).join(" ");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

export type HeaderCheck =
  | { ok: true; hash: string; needsIdColumn: boolean }
  | { ok: false; reason: string };

/**
 * Whether a sheet's header row is the Tavren layout.
 *
 * Reports the FIRST mismatch by column letter, because the person fixing it is
 * looking at a spreadsheet and needs to know which cell to change.
 *
 * A sheet kept by hand before Tavren existed will have every column but the id.
 * That is reported as `needsIdColumn` rather than refused: the caller writes the
 * heading in, and an otherwise-correct sheet is adopted instead of rejected over
 * a column the team never knew to add.
 */
export function checkHeaders(headers: readonly string[]): HeaderCheck {
  const seen = headers.map((h) => (h ?? "").trim());
  const idIndex = TEMPLATE_HEADERS.length - 1;
  let needsIdColumn = false;

  for (const { index, text } of FIXED_HEADERS) {
    const actual = seen[index] ?? "";

    if (index === idIndex && actual === "") {
      needsIdColumn = true;
      continue;
    }

    if (actual.toLowerCase() !== text.toLowerCase()) {
      const column = String.fromCharCode(65 + index);
      return {
        ok: false,
        reason: actual
          ? `Column ${column} should be "${text}" but says "${actual}".`
          : `Column ${column} is empty; it should be "${text}".`,
      };
    }
  }

  // Hash what the sheet WILL look like once the id heading is written, so the
  // drift check does not trip on the very column we are about to add.
  const settled = [...seen];
  settled[idIndex] = TEMPLATE_HEADERS[idIndex];
  return { ok: true, hash: headerHash(settled), needsIdColumn };
}

/**
 * Accepts a full Google Sheets URL or a bare id.
 *
 * People copy the URL from their browser; asking for "the id" means explaining
 * which part of the URL that is, and getting it wrong quietly.
 */
export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];
  // A bare id: Google ids are long and contain no slashes or spaces.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export function sheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/**
 * The link that copies the Tavren template into the clicker's OWN Drive.
 *
 * This is the workaround for having no Google Workspace. A service account
 * cannot safely create the sheet, because the file would live in its Drive with
 * no human owner and become unreachable the day the credentials rotate. Google's
 * own `/copy` endpoint makes the copy under the signed-in person instead, so the
 * sheet is owned by somebody real from the moment it exists.
 */
export function templateCopyUrl(templateId: string): string {
  return `https://docs.google.com/spreadsheets/d/${templateId}/copy`;
}

/**
 * Finds a work log's row from the sheet's id column.
 *
 * `hint` is the row number last recorded for this entry. It is checked first and
 * is almost always right; the scan exists because a person sorting the sheet or
 * inserting rows above invalidates every hint at once, and silently writing to a
 * stale row number is how the previous implementation would have overwritten
 * unrelated entries.
 *
 * `column` holds the id column's values starting at `firstDataRow`. Returns null
 * when the id is absent entirely, which means a human deleted the row: the
 * caller skips rather than guessing where it used to be.
 */
export function locateRow(
  column: readonly string[],
  workLogId: string,
  hint: number | null,
  firstDataRow = FIRST_DATA_ROW,
): number | null {
  const at = (row: number) => (column[row - firstDataRow] ?? "").trim();

  if (hint !== null && hint >= firstDataRow && at(hint) === workLogId) {
    return hint;
  }

  const index = column.findIndex((v) => (v ?? "").trim() === workLogId);
  return index === -1 ? null : index + firstDataRow;
}
