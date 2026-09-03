import type { GridColKey } from "@/lib/grid-columns";
import type { RowLock } from "@/lib/grid-permissions";
import type { GridField } from "@/server/grid-schemas";
import type { GridRow } from "@/server/grid-queries";

export type { GridRow, GridColKey, RowLock };

/** A cell address within the rendered grid. */
export type CellRef = { r: number; c: number };

/**
 * A row as the grid holds it: the server's row plus what the client knows —
 * whether it has been saved yet, and whether it has been withdrawn.
 *
 * Keyed by `rowKey` rather than array index, because a paste can insert rows
 * and a save can turn a draft into a real one; an index-keyed status map would
 * then point at the wrong row.
 */
export type EditableRow = {
  rowKey: string;
  id: string;
  revisionId: string | null;
  workDate: string;
  hours: string;
  notes: string;
  personName: string;
  /** Whose row it is, as a verdict — the grid is never told who owns what. */
  isMine: boolean;
  fromTimer: boolean;
  editable: boolean;
  lock: RowLock | null;
  /** Not yet an entry: typed into the blank row at the foot of the grid. */
  isDraft: boolean;
  /** Withdrawn this session. Kept on screen so the rows beneath it do not move. */
  removed: boolean;
};

export type RowStatus = {
  state: "saving" | "saved" | "error";
  message?: string;
  field?: GridField | null;
};
