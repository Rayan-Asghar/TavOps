/**
 * The grid's column model, matching the team's sheet layout column for column.
 *
 * One source of truth for the grid, the paste planner and the CSV export, so a
 * block copied out of the project's Google sheet lands on the right columns when
 * it is pasted back in. The order and the count are `TEMPLATE_HEADERS`' — see
 * `sheet-template.ts`.
 *
 * Two columns are the team's and are never written by Tavren: B (the project
 * label) and E (Link). They are kept here, read-only, rather than dropped,
 * because dropping them would shift every column after them and a six-wide
 * sheet block would paste one column out of true.
 */

export type GridColKey =
  | "date"
  | "label"
  | "person"
  | "hours"
  | "notes"
  | "link"
  | "id";

export type GridColumn = {
  key: GridColKey;
  /** The heading, matching the sheet where the sheet has one. */
  label: string;
  /** Column letter in the sheet, or null for grid-only columns. */
  sheetColumn: string | null;
  editable: boolean;
  /** Part of the sheet's shape, but not worth a column on screen. */
  hidden?: true;
  align: "left" | "right";
  /** Rendering width hint, in px. */
  width: number;
};

export const GRID_COLUMNS: readonly GridColumn[] = [
  { key: "date",   label: "Date",              sheetColumn: "A", editable: true,  align: "left",  width: 130 },
  // B and E are the team's columns and are empty on EVERY data row. They stay
  // in this list because the sheet's shape is defined here — copy, paste and
  // the CSV all need them — but they are not rendered: two empty slivers on
  // screen read as a rendering fault, and alignment with a pasted sheet block
  // is resolved by column name now, not by counting positions.
  { key: "label",  label: "",                  sheetColumn: "B", editable: false, hidden: true, align: "left", width: 28 },
  { key: "person", label: "Person",            sheetColumn: null, editable: false, align: "left", width: 130 },
  { key: "hours",  label: "Hours",             sheetColumn: "C", editable: true,  align: "right", width: 88 },
  { key: "notes",  label: "Notes — Work Done", sheetColumn: "D", editable: true,  align: "left",  width: 520 },
  { key: "link",   label: "",                  sheetColumn: "E", editable: false, hidden: true, align: "left", width: 28 },
  { key: "id",     label: "Work Log ID",       sheetColumn: "F", editable: false, align: "left",  width: 210 },
] as const;

/** The columns a person types into. */
export const EDITABLE_COLUMNS = GRID_COLUMNS.filter((c) => c.editable);

/** What the grid actually draws. */
export const VISIBLE_COLUMNS = GRID_COLUMNS.filter((c) => !c.hidden);

export function columnByKey(key: GridColKey): GridColumn {
  const found = GRID_COLUMNS.find((c) => c.key === key);
  if (!found) throw new Error(`Unknown grid column: ${key}`);
  return found;
}

/**
 * The sheet's own column order, for reading a pasted block that came from it.
 *
 * `person` is absent on purpose: the sheet has no Developer column, because who
 * did the work is answered by the work log, the activity feed and /reports.
 */
export const SHEET_COLUMN_ORDER: readonly GridColKey[] = [
  "date",
  "label",
  "hours",
  "notes",
  "link",
  "id",
] as const;
