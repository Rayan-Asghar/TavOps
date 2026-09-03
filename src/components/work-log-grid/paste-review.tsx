"use client";

import { useEffect, useRef } from "react";
import type { PastePlan } from "@/lib/grid-paste";

/**
 * What a paste would do, before it does it.
 *
 * Rendered above the grid rather than as a modal: a dialog would cover the rows
 * being described, which is the one thing somebody checking a twenty-row paste
 * needs to see. Refused rows do not block the rest — pasting a month where the
 * first three days fall inside an invoiced period should still write the other
 * twenty-seven, and say which it skipped and why.
 */
export function PasteReview({
  plan,
  needsReason,
  reason,
  onReason,
  onApply,
  onCancel,
  applying,
}: {
  plan: PastePlan;
  needsReason: boolean;
  reason: string;
  onReason: (v: string) => void;
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const total = plan.updates.length + plan.creates.length;
  const blocked = needsReason && !reason.trim();

  return (
    <section
      aria-label="Review paste"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mb-4 rounded-[14px] border border-border bg-surface"
    >
      <div className="border-b border-border px-4 py-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-sm font-black text-fg outline-none"
        >
          {summary(plan)}
        </h2>
        {plan.sheetShaped && (
          <p className="m-0 mt-1 text-2xs text-fg-muted">
            Read in the sheet&rsquo;s column order, so a block copied out of the
            project&rsquo;s sheet lines up without being rearranged.
          </p>
        )}
        {plan.matchedById && (
          <p className="m-0 mt-1 text-2xs text-fg-muted">
            Matched by work log id, so the order of the pasted rows does not
            matter.
          </p>
        )}
        {plan.truncatedCols > 0 && (
          <p className="m-0 mt-1 text-2xs text-warn">
            {plan.truncatedCols} column{plan.truncatedCols === 1 ? "" : "s"} fell
            past the edge of the grid and will be ignored.
          </p>
        )}
      </div>

      <div className="max-h-[260px] overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {plan.updates.slice(0, 20).map((u) => (
              <tr key={u.rowKey} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 text-2xs font-black uppercase tracking-[.08em] text-fg-label">
                  Change
                </td>
                <td className="px-2 py-2 text-fg-muted line-through">
                  {u.before.workDate} · {u.before.hours} · {u.before.notes}
                </td>
                <td className="px-2 py-2 text-fg">→</td>
                <td className="px-4 py-2 text-fg">
                  {u.changes.workDate ?? u.before.workDate} ·{" "}
                  {u.changes.hours ?? u.before.hours} ·{" "}
                  {u.changes.notes ?? u.before.notes}
                </td>
              </tr>
            ))}
            {plan.creates.slice(0, 20).map((c, i) => (
              <tr key={`new-${i}`} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 text-2xs font-black uppercase tracking-[.08em] text-ok">
                  New
                </td>
                <td colSpan={3} className="px-2 py-2 text-fg">
                  {c.workDate} · {c.hours} · {c.notes}
                </td>
              </tr>
            ))}
            {plan.refused.map((r) => (
              <tr
                key={`refused-${r.blockRow}`}
                className="border-b border-border last:border-b-0 bg-danger-soft"
              >
                <td className="px-4 py-2 text-2xs font-black uppercase tracking-[.08em] text-danger">
                  Row {r.blockRow}
                </td>
                <td colSpan={3} className="px-2 py-2 text-fg">
                  {r.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-border px-4 py-3">
        {needsReason && (
          <div className="min-w-[260px] flex-1">
            <label className="label" htmlFor="paste-reason">
              Why these changes
            </label>
            <input
              id="paste-reason"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              placeholder="Required: this paste changes somebody else's entries"
              className="field field-sm w-full"
            />
          </div>
        )}
        <button
          type="button"
          onClick={onApply}
          disabled={applying || total === 0 || blocked}
          className="btn-primary btn-sm"
        >
          {applying ? "Applying…" : `Apply ${total} change${total === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </section>
  );
}

function summary(plan: PastePlan): string {
  const bits: string[] = [];
  if (plan.updates.length) bits.push(`${plan.updates.length} changed`);
  if (plan.creates.length) bits.push(`${plan.creates.length} new`);
  if (plan.refused.length) bits.push(`${plan.refused.length} refused`);
  if (bits.length === 0) return "Nothing in that block would change anything.";
  const rows = plan.updates.length + plan.creates.length + plan.refused.length;
  return `${rows} row${rows === 1 ? "" : "s"}: ${bits.join(", ")}`;
}
