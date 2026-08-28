import { z } from "zod";

/**
 * The Tavren fields a sheet column can be mapped to.
 *
 * There is deliberately no way to map the internal note. A client sheet can
 * only ever receive the client update a person wrote on purpose — the field
 * called "notes" here IS that client line, and nothing else can reach a sheet.
 */
export const SHEET_FIELDS = [
  { key: "date", label: "Date", hint: "The day the work was done" },
  { key: "taskTitle", label: "Task", hint: "Task name, or 'general project work'" },
  { key: "developer", label: "Developer", hint: "Who logged it" },
  { key: "hours", label: "Hours", hint: "Decimal, e.g. 5.78" },
  { key: "notes", label: "Client update", hint: "The one line written for the client" },
  { key: "status", label: "Status", hint: "Task status after the update" },
] as const;

/**
 * The standard Tavren client timesheet.
 *
 * Most clients take whatever sheet we give them, so this is the fast path: the
 * head shares a blank sheet, one click writes these headers and derives the
 * mapping, and nobody hand-maps columns. The manual mapping flow stays for the
 * clients who insist on their own layout.
 */
export const CLIENT_TEMPLATE_COLUMNS = [
  { field: "date", header: "Work Date" },
  { field: "taskTitle", header: "Task" },
  { field: "developer", header: "Developer" },
  { field: "hours", header: "Hours" },
  { field: "notes", header: "Update" },
  { field: "status", header: "Status" },
] as const;

/** Column letters for the template, in order: A, B, C, ... */
export function templateColumnMap(): Record<string, string> {
  const map: Record<string, string> = {};
  CLIENT_TEMPLATE_COLUMNS.forEach((c, i) => {
    map[c.field] = String.fromCharCode(65 + i);
  });
  return map;
}

export type SheetField = (typeof SHEET_FIELDS)[number]["key"];

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

export const inspectSheetSchema = z.object({
  projectId: z.string().uuid(),
  sheetUrl: z.string().trim().min(1, "Paste the Google Sheet link."),
});

export const saveMappingSchema = z.object({
  projectId: z.string().uuid(),
  spreadsheetId: z.string().min(20),
  sheetName: z.string().trim().min(1, "Pick a tab."),
  mode: z.enum(["append", "update"]),
  headerRow: z.coerce.number().int().min(1).max(20).default(1),
  columnMap: z
    .record(z.string(), z.string().regex(/^[A-Za-z]{1,3}$/, "Use a column letter."))
    .refine((m) => Object.keys(m).length > 0, {
      message: "Map at least one column.",
    }),
  /** Columns the client maintains. The OS never writes to these. */
  clientOwnedColumns: z
    .array(z.string().regex(/^[A-Za-z]{1,3}$/))
    .default([]),
});

export const applyTemplateSchema = z.object({
  projectId: z.string().uuid(),
  sheetUrl: z.string().trim().min(1, "Paste the Google Sheet link."),
  sheetName: z.string().trim().min(1).default("Sheet1"),
});
