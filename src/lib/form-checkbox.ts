/**
 * Reading a checkbox that has three meanings, not two.
 *
 * An unchecked HTML checkbox sends NOTHING. So `formData.get("billable")`
 * returns null both when the person unticked it and when the form never had the
 * control at all — and for billability those mean opposite things: unticked is
 * "not billable", absent is "inherit from the kind of work". Collapsing them
 * would make every entry from a form without the field explicitly billable,
 * defeating the inheritance the field exists to allow overriding.
 *
 * The fix is the old hidden-companion trick. A form renders both, in order:
 *
 *   <input type="hidden"   name="billable" value="false" />
 *   <input type="checkbox" name="billable" value="true" defaultChecked />
 *
 * so the browser sends `["false", "true"]` when ticked, `["false"]` when not,
 * and nothing at all when the control was never rendered. The last value wins,
 * which is exactly the checkbox's own state.
 */
export function readTriStateCheckbox(
  values: readonly FormDataEntryValue[],
): boolean | null {
  if (values.length === 0) return null;
  const last = values[values.length - 1];
  return String(last) === "true";
}
