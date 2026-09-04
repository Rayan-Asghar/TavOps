/**
 * The billable checkbox, in one place.
 *
 * Ticked by default and cheap to change, rather than a required choice. The
 * argument is in `src/lib/billable.ts`: a required field on every entry buys
 * accuracy on something true nine times in ten and pays for it in entries that
 * never get logged, and an unlogged hour is unrecoverable where a wrongly
 * flagged one is one click.
 *
 * But a SILENT default would be just as wrong — nobody would ever mark anything
 * non-billable and the split would read 100% billable forever — so the control
 * is visible, with a hint naming the cases it is for.
 *
 * The hidden companion is load-bearing: an unticked checkbox sends nothing, so
 * without it the server cannot tell "unticked" from "this form has no such
 * field", and those mean opposite things. See `readTriStateCheckbox`.
 */
export function BillableField({
  defaultChecked = true,
  /** Shown when the value is inherited rather than chosen, e.g. "from Design". */
  inheritedFrom,
  /** Both `/log` and the entry list render several of these on one page, so the
   *  id has to be per-instance or the labels point at the wrong checkbox. */
  idSuffix,
}: {
  defaultChecked?: boolean;
  inheritedFrom?: string | null;
  idSuffix?: string;
}) {
  const id = idSuffix ? `billable-${idSuffix}` : "billable";
  return (
    <div>
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input type="hidden" name="billable" value="false" />
        <input
          id={id}
          type="checkbox"
          name="billable"
          value="true"
          defaultChecked={defaultChecked}
          className="h-4 w-4"
        />
        <span>Billable</span>
      </label>
      <p className="mt-1 text-2xs text-fg-subtle">
        {inheritedFrom
          ? `Set from ${inheritedFrom}. Untick for internal work, rework or admin.`
          : "Untick for internal meetings, rework or admin."}
      </p>
    </div>
  );
}
