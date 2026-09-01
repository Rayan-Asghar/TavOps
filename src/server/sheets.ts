import { google, type sheets_v4 } from "googleapis";
import { ID_COLUMN, ROW_RANGE } from "@/lib/sheet-template";

/**
 * Google Sheets access for the project work-log mirror.
 *
 * The service account authenticates once and is shared into each project's
 * sheet as an Editor. Writes are one-way: nothing here reads a value back into
 * the database, so the failure mode to design for is a revoked share or an
 * edited header row, not conflicting edits.
 *
 * Every call is batched by the worker before it gets here. A drain that appends
 * twenty entries to one sheet is one request, not twenty, which is what keeps
 * this comfortably inside the API's per-minute quota.
 */

let cached: sheets_v4.Sheets | null = null;

export function sheetsClient(): sheets_v4.Sheets {
  if (cached) return cached;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.",
    );
  }

  const auth = new google.auth.JWT({
    email,
    // Env files store the key with escaped newlines; the JWT signer needs real ones.
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cached = google.sheets({ version: "v4", auth });
  return cached;
}

/** Test seam: lets the worker's state machine be exercised without a network. */
export function __setSheetsClientForTests(client: sheets_v4.Sheets | null) {
  cached = client;
}

/**
 * Builds an A1 range with the sheet name quoted correctly.
 *
 * A tab called "Time Log" produces `Time Log!A:H`, which the API rejects with
 * `Unable to parse range`. Names containing anything but letters, digits and
 * underscores must be single-quoted, and literal single quotes doubled. Real
 * tab names look like "Sep 2026" far more often than "Sheet1", so this is the
 * normal case, not the edge case.
 */
export function a1Range(sheetName: string, ref: string): string {
  const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
  return `${safe}!${ref}`;
}

/** 429 and 5xx are worth retrying; a 403 from an unshared sheet is not. */
export function isRetryableSheetsError(err: unknown): boolean {
  const status =
    (err as { code?: number; status?: number })?.code ??
    (err as { status?: number })?.status;
  if (typeof status !== "number") return true;
  return status === 429 || (status >= 500 && status < 600);
}

export type SheetMeta = {
  title: string;
  tabs: { title: string; sheetId: number }[];
};

export async function readMeta(spreadsheetId: string): Promise<SheetMeta> {
  const res = await sheetsClient().spreadsheets.get({ spreadsheetId });
  return {
    title: res.data.properties?.title ?? "Untitled",
    tabs: (res.data.sheets ?? [])
      .map((s) => ({
        title: s.properties?.title ?? "",
        sheetId: s.properties?.sheetId ?? 0,
      }))
      .filter((t) => t.title !== ""),
  };
}

export async function readHeaderRow(
  spreadsheetId: string,
  tabName: string,
): Promise<string[]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: a1Range(tabName, "1:1"),
  });
  return (res.data.values?.[0] ?? []).map((v) => String(v ?? ""));
}

/**
 * Reads the id column, which is how rows are addressed.
 *
 * One read per connection per drain, shared by every job in that batch. Doing it
 * per job would re-read the same column once for every entry being corrected.
 */
export async function readIdColumn(
  spreadsheetId: string,
  tabName: string,
): Promise<string[]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range: a1Range(tabName, `${ID_COLUMN}2:${ID_COLUMN}`),
  });
  return (res.data.values ?? []).map((r) => String(r?.[0] ?? ""));
}

/**
 * Appends rows, returning the row number each one landed on.
 *
 * Google answers with the range it actually wrote, e.g. `'Sep 2026'!A7:H9`.
 * Capturing the first row lets the caller record where each entry went, which is
 * the hint a later correction starts from. USER_ENTERED so a date reads as a
 * date and hours as a number rather than as text.
 */
export async function appendRows(
  spreadsheetId: string,
  tabName: string,
  rows: string[][],
): Promise<number[]> {
  if (rows.length === 0) return [];

  const res = await sheetsClient().spreadsheets.values.append({
    spreadsheetId,
    range: a1Range(tabName, ROW_RANGE),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  const first = firstRowOfRange(res.data.updates?.updatedRange);
  if (first === null) return [];
  return rows.map((_, i) => first + i);
}

/**
 * Pulls the first row number out of an append response.
 *
 * Returns null rather than guessing if the shape is unfamiliar. A wrong row
 * number here would be recorded as a hint and later used to overwrite somebody
 * else's row.
 */
export function firstRowOfRange(range: string | null | undefined): number | null {
  if (!range) return null;
  const m = range.match(/![A-Z]+(\d+)(?::|$)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Overwrites whole rows, one targeted range each, in a single request.
 *
 * Ranges are `A{row}:H{row}` so the write stops at the template's last column.
 * Anything the team keeps to the right of it, a Blocker column say, is never
 * touched by Tavren.
 */
export async function updateRows(
  spreadsheetId: string,
  tabName: string,
  updates: { row: number; cells: string[] }[],
): Promise<void> {
  if (updates.length === 0) return;

  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({
        range: a1Range(tabName, `A${u.row}:${ID_COLUMN}${u.row}`),
        values: [u.cells],
      })),
    },
  });
}

/**
 * Hides the id column so the sheet reads normally to a person.
 *
 * Cosmetic, and deliberately not fatal: a sheet whose id column is visible still
 * syncs correctly, so a failure here must not block connecting.
 */
export async function hideIdColumn(
  spreadsheetId: string,
  sheetId: number,
): Promise<void> {
  const index = ID_COLUMN.charCodeAt(0) - 65;
  await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: index,
              endIndex: index + 1,
            },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
          },
        },
      ],
    },
  });
}
