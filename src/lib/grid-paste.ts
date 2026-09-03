import {
  SHEET_COLUMN_ORDER,
  columnByKey,
  type GridColKey,
  type GridColumn,
} from "./grid-columns";
import { parseGridDate, parseHours, formatHours } from "./grid-parse";

/**
 * Reading a block pasted into the grid, and writing one out.
 *
 * Pure, and the highest-value thing in this feature to have tests for: a paste
 * is the one gesture that can rewrite thirty entries at once, and getting the
 * alignment wrong by a single row would restate a month of somebody's work
 * without anybody noticing.
 *
 * The format is TSV rather than CSV, because that is what Excel and Sheets put
 * on the clipboard and what they accept back without an import dialog.
 */

export type PasteCell = { col: GridColKey; value: string };

export type PasteUpdate = {
  rowIndex: number;
  rowKey: string;
  workLogId: string;
  changes: Partial<Record<"workDate" | "hours" | "notes", string>>;
  before: { workDate: string; hours: string; notes: string };
};

export type PasteCreate = {
  workDate: string;
  hours: string;
  notes: string;
};

export type PasteRefusal = {
  /** 1-based, as the user counts rows in the block they pasted. */
  blockRow: number;
  reason: string;
};

export type PastePlan = {
  updates: PasteUpdate[];
  creates: PasteCreate[];
  refused: PasteRefusal[];
  /** Columns in the block that fell past the right-hand edge of the grid. */
  truncatedCols: number;
  /** True when the block carried Work Log IDs and rows were matched by them. */
  matchedById: boolean;
  /** True when the block was read in the sheet's column order. */
  sheetShaped: boolean;
};

/** Rows the planner needs to know about, in the order they are displayed. */
export type PasteTargetRow = {
  rowKey: string;
  id: string;
  workDate: string;
  hours: string;
  notes: string;
  editable: boolean;
  isDraft: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Splits a clipboard payload into a grid.
 *
 * TSV has no quoting, so there is nothing to unescape — which is also why a
 * value containing a tab or a newline cannot survive the trip and is replaced
 * on the way out rather than corrupting the columns.
 */
export function parseTsv(text: string): string[][] {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!body) return [];
  return body.split("\n").map((line) => line.split("\t"));
}

/**
 * A block for the clipboard.
 *
 * Tabs and newlines inside a note are substituted, not escaped: a spreadsheet
 * reading TSV would treat either as a cell or row break and silently shear the
 * block into the wrong shape.
 */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((r) => r.map((c) => c.replace(/\t/g, " ").replace(/\n/g, " · ")).join("\t"))
    .join("\n");
}

/**
 * Where a pasted block lands, and what it would do.
 *
 * Positional by default — rows landing on existing rows are corrections, rows
 * falling past the last one are new entries — which is what a spreadsheet user
 * expects. But if the block carries the Work Log ID column, rows are matched by
 * that id instead. That is the workflow this grid exists to serve: copy a month
 * out of the project's sheet, fix it in Excel, paste it back. Somebody sorting
 * or inserting a row invalidates every position at once, and the id is the one
 * thing that survives it — the same argument `locateRow` makes for addressing
 * sheet rows by uuid rather than by row number.
 */
export function planPaste(input: {
  block: string[][];
  anchor: { r: number; c: number };
  rows: PasteTargetRow[];
  /** The columns actually rendered, which is what the anchor indexes into. */
  columns: readonly GridColumn[];
  /** `YYYY-MM`; a date outside it belongs to another tab. */
  month: string;
  canCreate: boolean;
}): PastePlan {
  const { block, anchor, rows, columns, month, canCreate } = input;

  const plan: PastePlan = {
    updates: [],
    creates: [],
    refused: [],
    truncatedCols: 0,
    matchedById: false,
    sheetShaped: false,
  };
  if (block.length === 0) return plan;

  // Which grid column each column of the block lands on.
  //
  // A block the width of the sheet, pasted at the left edge, is read in the
  // SHEET's column order rather than by position. The sheet has no Person
  // column and the grid does, so a six-wide block copied out of the sheet would
  // otherwise land one column out from the third column on — putting hours into
  // the notes cell. Since that round trip is the whole reason paste exists here,
  // the sheet's shape is recognised rather than the user being asked to line it
  // up by hand.
  const width = Math.max(...block.map((r) => r.length));
  const sheetShaped = anchor.c === 0 && width === SHEET_COLUMN_ORDER.length;
  const landing: (GridColumn | null)[] = [];
  for (let j = 0; j < width; j++) {
    if (sheetShaped) {
      landing.push(columnByKey(SHEET_COLUMN_ORDER[j]));
      continue;
    }
    const c = anchor.c + j;
    if (c >= columns.length) plan.truncatedCols++;
    landing.push(c < columns.length ? columns[c] : null);
  }

  plan.sheetShaped = sheetShaped;
  const idAt = landing.findIndex((c) => c?.key === "id");
  const byId = new Map(rows.filter((r) => !r.isDraft).map((r) => [r.id, r]));
  plan.matchedById =
    idAt !== -1 && block.some((r) => UUID_RE.test((r[idAt] ?? "").trim()));

  block.forEach((line, i) => {
    const blockRow = i + 1;

    // A cell per editable column, ignoring the ones Tavren never writes.
    const cells: PasteCell[] = [];
    landing.forEach((col, j) => {
      if (!col || !col.editable) return;
      const raw = line[j];
      if (raw === undefined) return;
      cells.push({ col: col.key, value: raw });
    });

    let target: PasteTargetRow | undefined;
    let rowIndex = anchor.r + i;

    if (plan.matchedById) {
      const id = (line[idAt] ?? "").trim();
      if (!UUID_RE.test(id)) {
        // A block that identifies its rows must identify all of them; guessing
        // for the odd one is how a paste lands on the wrong entry.
        plan.refused.push({
          blockRow,
          reason: "This row has no work log id, and the rest of the block does.",
        });
        return;
      }
      target = byId.get(id);
      if (!target) {
        plan.refused.push({
          blockRow,
          reason: "That entry is not in this month.",
        });
        return;
      }
      rowIndex = rows.indexOf(target);
    } else {
      target = rows[rowIndex];
    }

    if (cells.length === 0) {
      plan.refused.push({
        blockRow,
        reason: "Nothing in this row lands on a column the grid writes.",
      });
      return;
    }

    const read = readCells(cells);
    if ("error" in read) {
      plan.refused.push({ blockRow, reason: read.error });
      return;
    }

    // A new entry: past the last row, or onto the blank one at the foot.
    if (!target || target.isDraft) {
      if (!canCreate) {
        plan.refused.push({ blockRow, reason: "New entries cannot be added here." });
        return;
      }
      const { workDate, hours, notes } = read.values;
      if (!workDate || !hours || !notes) {
        plan.refused.push({
          blockRow,
          reason: "A new entry needs a date, hours and a note.",
        });
        return;
      }
      if (workDate.slice(0, 7) !== month) {
        plan.refused.push({ blockRow, reason: outsideMonth(workDate) });
        return;
      }
      plan.creates.push({ workDate, hours, notes });
      return;
    }

    if (!target.editable) {
      plan.refused.push({ blockRow, reason: "That entry cannot be changed." });
      return;
    }

    const changes: PasteUpdate["changes"] = {};
    for (const [k, v] of Object.entries(read.values)) {
      if (v === undefined) continue;
      const key = k as keyof PasteUpdate["changes"];
      if (target[key] !== v) changes[key] = v;
    }
    if (changes.workDate && changes.workDate.slice(0, 7) !== month) {
      plan.refused.push({ blockRow, reason: outsideMonth(changes.workDate) });
      return;
    }
    if (Object.keys(changes).length === 0) return; // nothing to do, silently

    plan.updates.push({
      rowIndex,
      rowKey: target.rowKey,
      workLogId: target.id,
      changes,
      before: {
        workDate: target.workDate,
        hours: target.hours,
        notes: target.notes,
      },
    });
  });

  return plan;
}

function outsideMonth(iso: string): string {
  return `That day is outside the month you are editing (${iso}) — switch months first.`;
}

type ReadValues = {
  workDate?: string;
  hours?: string;
  notes?: string;
};

function readCells(
  cells: PasteCell[],
): { values: ReadValues } | { error: string } {
  const values: ReadValues = {};
  for (const { col, value } of cells) {
    const raw = value.trim();
    if (col === "date") {
      if (!raw) continue;
      const r = parseGridDate(raw);
      if (!r.ok) return { error: r.error };
      values.workDate = r.value;
    } else if (col === "hours") {
      if (!raw) continue;
      const r = parseHours(raw);
      if (!r.ok) return { error: r.error };
      values.hours = formatHours(r.value);
    } else if (col === "notes") {
      if (!raw) continue;
      values.notes = raw;
    }
  }
  return { values };
}
