/**
 * Whether an entry falls inside a period already invoiced to the client.
 *
 * `projects.invoiced_through` has existed since the first migration and until
 * work-log correction was built, nothing read it. It is the one hard stop on
 * changing an entry: the hours behind a sent invoice are a record of what was
 * charged, and quietly restating them makes the invoice unexplainable.
 *
 * Pure and separate from the action so the boundary case is testable — a
 * `"use server"` module may only export async functions, so a predicate cannot
 * live there and still be reachable from a test.
 */
export function isInvoiced(
  workDate: Date,
  /** `YYYY-MM-DD`, inclusive. Null means nothing has been invoiced yet. */
  invoicedThrough: string | null,
): boolean {
  if (!invoicedThrough) return false;
  // Inclusive: "invoiced through the 31st" covers work done ON the 31st.
  return workDate.toISOString().slice(0, 10) <= invoicedThrough;
}
