import { google, type sheets_v4 } from "googleapis";

/**
 * Google Sheets access for client-facing timesheets.
 *
 * The service account authenticates once and is shared with each client sheet
 * as an Editor. Sheets API quota is 300 write requests/minute per project and
 * costs nothing, which is far beyond what a dozen developers can generate — the
 * failure mode to design for is a revoked share or a renamed tab, not volume.
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

export type ColumnMap = Record<string, string>;

/** Values keyed by Tavren field name, e.g. { hours: "6", notes: "Hero done" }. */
export type RowValues = Record<string, string>;

function columnToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/**
 * Appends a row, placing each mapped value in its own column.
 *
 * Unmapped columns are sent as empty strings rather than skipped, because the
 * Sheets API positions appended values by offset from the start of the range.
 */
export async function appendRow(opts: {
  spreadsheetId: string;
  sheetName: string;
  columnMap: ColumnMap;
  values: RowValues;
}) {
  const sheets = sheetsClient();

  const indices = Object.entries(opts.columnMap).map(([field, col]) => ({
    field,
    index: columnToIndex(col),
  }));
  const width = Math.max(...indices.map((i) => i.index)) + 1;

  const row = new Array<string>(width).fill("");
  for (const { field, index } of indices) {
    row[index] = opts.values[field] ?? "";
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.sheetName}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

/**
 * Updates an existing row, touching ONLY the mapped columns.
 *
 * This is deliberate and load-bearing: client sheets routinely carry columns
 * the client maintains themselves — approval notes, priorities, their own
 * comments. Writing a whole row would silently erase those, which is the kind
 * of bug that costs a client relationship. One targeted range per mapped
 * column, batched into a single request.
 */
export async function updateRowCells(opts: {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  columnMap: ColumnMap;
  values: RowValues;
}) {
  const sheets = sheetsClient();

  const data = Object.entries(opts.columnMap)
    .filter(([field]) => opts.values[field] !== undefined)
    .map(([field, col]) => ({
      range: `${opts.sheetName}!${col}${opts.rowNumber}`,
      values: [[opts.values[field] ?? ""]],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: opts.spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

/** Reads the header row so the mapping UI can suggest column assignments. */
export async function readHeaderRow(opts: {
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
}): Promise<{ column: string; label: string }[]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.sheetName}!${opts.headerRow}:${opts.headerRow}`,
  });

  const headers = res.data.values?.[0] ?? [];
  return headers.map((label, i) => ({
    column: indexToColumn(i),
    label: String(label ?? ""),
  }));
}

export function indexToColumn(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 429 and 5xx are worth retrying; a 403 from an unshared sheet is not. */
export function isRetryableSheetsError(err: unknown): boolean {
  const status =
    (err as { code?: number; status?: number })?.code ??
    (err as { status?: number })?.status;
  if (typeof status !== "number") return true;
  return status === 429 || (status >= 500 && status < 600);
}
