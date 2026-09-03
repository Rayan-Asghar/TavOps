import { isInvoiced } from "./billing-lock";

/**
 * Whether one row of the grid may be typed into, and if not, why.
 *
 * Pure and separate from both the query and the action because all three need
 * the same answer: the page uses it to grey a cell, the export uses it to label
 * one, and the save re-derives it inside the transaction from a freshly locked
 * row. A verdict computed once and trusted thereafter would be an authorization
 * check the client could turn off.
 *
 * The reasons are a closed set, and the sentences live here rather than in the
 * components, so what the grid says when it refuses a keystroke is word for word
 * what the server says when it refuses the write.
 */

export type RowLock = "invoiced" | "not-yours" | "removed";

export const LOCK_REASONS: Record<RowLock, string> = {
  invoiced: "That work has already been invoiced and can no longer be changed.",
  "not-yours": "That entry belongs to somebody else.",
  removed: "That entry has already been removed.",
};

export type RowFacts = {
  workDate: Date;
  userId: string;
  deleted?: boolean;
};

export type ViewerFacts = {
  actorId: string;
  /** `can(role, "worklog.edit")`, resolved once for the page. */
  canEditOthers: boolean;
  /** `projects.invoiced_through`, `YYYY-MM-DD` or null. */
  invoicedThrough: string | null;
};

/**
 * Invoiced wins over ownership: it applies to everyone including an admin, and
 * "this is billed" is the more useful thing to be told. Removal wins over both,
 * because there is nothing left to edit.
 */
export function rowLock(row: RowFacts, viewer: ViewerFacts): RowLock | null {
  if (row.deleted) return "removed";
  if (isInvoiced(row.workDate, viewer.invoicedThrough)) return "invoiced";
  if (row.userId !== viewer.actorId && !viewer.canEditOthers) return "not-yours";
  return null;
}

export function isEditable(row: RowFacts, viewer: ViewerFacts): boolean {
  return rowLock(row, viewer) === null;
}
