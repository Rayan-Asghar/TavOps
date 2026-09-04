/**
 * Whether an hour bills, decided without asking anyone.
 *
 * The alternative — a required choice on every entry — buys accuracy on a field
 * that is true well over nine times in ten, and pays for it in entries that
 * never get logged at all. `quick-log.tsx` states the constraint plainly: it is
 * used on a phone at 1am, and every extra field is a reason not to bother. An
 * unlogged hour is unrecoverable; a wrongly-flagged one is one click to fix.
 *
 * So billability is INHERITED from the kind of work, the way Harvest's common
 * task list does it — Design and Programming bill, Business Development does
 * not — and the entry-level flag exists only to override.
 *
 * Resolved ONCE, at write time, and stored on the row. Resolving at read time
 * would mean editing a task type retroactively restates already-invoiced
 * history, which is the thing `worklog_revisions` exists to prevent.
 */

export type BillableSources = {
  /** What the person explicitly chose on this entry, if they chose. */
  entryOverride?: boolean | null;
  /** `task_types.billable` for the type named on the work log itself. */
  entryTypeBillable?: boolean | null;
  /** `task_types.billable` for the type on the task being logged against. */
  taskTypeBillable?: boolean | null;
};

export type BillableDecision = {
  billable: boolean;
  /** Which link in the chain decided it — for the audit payload, and so a UI
   *  can say "non-billable, from Business Development" rather than just "no". */
  source: "override" | "entry-type" | "task-type" | "default";
};

export function resolveBillable(s: BillableSources): BillableDecision {
  if (s.entryOverride !== null && s.entryOverride !== undefined) {
    return { billable: s.entryOverride, source: "override" };
  }
  // The work log's own type wins over the task's: a client call logged against
  // a Programming task is still a client call, and work_logs.task_id is
  // nullable precisely so that case can be recorded.
  if (s.entryTypeBillable !== null && s.entryTypeBillable !== undefined) {
    return { billable: s.entryTypeBillable, source: "entry-type" };
  }
  if (s.taskTypeBillable !== null && s.taskTypeBillable !== undefined) {
    return { billable: s.taskTypeBillable, source: "task-type" };
  }
  // Nothing classified this work. Billable is the safer default: it overstates
  // revenue rather than understating it, which is the error someone notices.
  // A project-level default would slot in here without changing the shape.
  return { billable: true, source: "default" };
}
