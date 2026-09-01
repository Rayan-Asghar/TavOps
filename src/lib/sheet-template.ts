import { createHash } from "node:crypto";

/**
 * The Tavren work-log sheet layout.
 *
 * Fixed, and deliberately not configurable. The previous client-facing sync let
 * each project map its own columns, and every bug it produced came from a
 * mapping that had drifted from the sheet it described. A stale mapping cannot
 * exist if there is no mapping.
 *
 * Pure and in `lib/` so the header rules are testable: a `"use server"` module
 * may only export async functions, and `server/` modules here import `@/db`,
 * which needs a live connection string at import time.
 */

export const TEMPLATE_VERSION = 1;

/**
 * Column H holds the work log's uuid and is what actually addresses a row.
 * Hidden in the sheet, but present: a person sorting or inserting rows moves
 * every row number, and this is what survives that.
 */
export const ID_COLUMN = "H";

export const TEMPLATE_HEADERS = [
  "Date",
  "Developer",
  "Project",
  "Task",
  "Hours",
  "Work Done",
  "Status",
  "Work Log ID",
] as const;

/** The range a full row occupies, for appends. */
export const ROW_RANGE = "A:H";

export type SheetRow = {
  date: string;
  developer: string;
  project: string;
  task: string;
  hours: string;
  workDone: string;
  status: string;
  workLogId: string;
};

/**
 * Row order must match TEMPLATE_HEADERS exactly. This is the single place that
 * pairs a value with its column, so the two cannot drift apart.
 */
export function toCells(row: SheetRow): string[] {
  return [
    row.date,
    row.developer,
    row.project,
    row.task,
    row.hours,
    row.workDone,
    row.status,
    row.workLogId,
  ];
}

/**
 * Fingerprints the header row.
 *
 * Compared on every drain. Somebody inserting a column would otherwise send
 * Hours quietly into the Status column and corrupt the sheet a row at a time
 * with nothing failing; the worker refuses to write on a mismatch instead.
 *
 * Case and surrounding whitespace are ignored. A person retyping "hours" as
 * "Hours " has not changed the layout, and treating that as drift would stop
 * syncing for no reason.
 */
export function headerHash(headers: readonly string[]): string {
  const normalised = headers.map((h) => (h ?? "").trim().toLowerCase()).join(" ");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

export type HeaderCheck =
  | { ok: true; hash: string }
  | { ok: false; reason: string };

/**
 * Whether a sheet's first row is the Tavren template.
 *
 * Reports the FIRST mismatch by column letter rather than "headers do not
 * match", because the person fixing it is looking at a spreadsheet and needs to
 * know which cell to change.
 */
export function checkHeaders(headers: readonly string[]): HeaderCheck {
  const seen = headers.map((h) => (h ?? "").trim());

  for (let i = 0; i < TEMPLATE_HEADERS.length; i++) {
    const expected = TEMPLATE_HEADERS[i];
    const actual = seen[i] ?? "";
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      const column = String.fromCharCode(65 + i);
      return {
        ok: false,
        reason: actual
          ? `Column ${column} should be "${expected}" but says "${actual}".`
          : `Column ${column} is empty; it should be "${expected}".`,
      };
    }
  }

  return { ok: true, hash: headerHash(seen.slice(0, TEMPLATE_HEADERS.length)) };
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
  firstDataRow = 2,
): number | null {
  const at = (row: number) => (column[row - firstDataRow] ?? "").trim();

  if (hint !== null && hint >= firstDataRow && at(hint) === workLogId) {
    return hint;
  }

  const index = column.findIndex((v) => (v ?? "").trim() === workLogId);
  return index === -1 ? null : index + firstDataRow;
}
