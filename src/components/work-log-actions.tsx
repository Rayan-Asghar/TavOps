"use client";

import { useActionState, useState } from "react";
import {
  editWorkLogFormAction,
  deleteWorkLogFormAction,
  type FormState,
} from "@/server/form-actions";

const initial: FormState = {};

/**
 * Correct or remove one entry.
 *
 * Collapsed by default. The activity list is read far more often than it is
 * corrected, and a row of controls on every entry turns a log into a form.
 *
 * Deleting asks for the reason in the same step rather than behind a confirm
 * dialog: having to say why is a better guard than having to click twice, and
 * it is the thing the reversal revision actually needs.
 */
export function WorkLogActions({
  workLogId,
  hours,
  notes,
  workDate,
}: {
  workLogId: string;
  hours: string;
  notes: string;
  /** yyyy-mm-dd, for the date input. */
  workDate: string;
}) {
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const [editState, editAction, editing] = useActionState(
    editWorkLogFormAction,
    initial,
  );
  const [delState, delAction, deleting] = useActionState(
    deleteWorkLogFormAction,
    initial,
  );

  const state = open === "delete" ? delState : editState;

  // The row is revalidated away on success, so this only shows in the moment
  // between the action returning and the page settling.
  if (state.ok) {
    return (
      <p className="mt-2 text-[10px] font-medium text-ok">{state.message}</p>
    );
  }

  if (!open) {
    return (
      <div className="mt-1.5 flex gap-3">
        <button
          type="button"
          onClick={() => setOpen("edit")}
          className="text-[9px] font-bold uppercase tracking-[.1em] text-fg-subtle hover:text-fg"
        >
          Correct
        </button>
        <button
          type="button"
          onClick={() => setOpen("delete")}
          className="text-[9px] font-bold uppercase tracking-[.1em] text-fg-subtle hover:text-danger"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form
      action={open === "edit" ? editAction : delAction}
      className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2 p-3"
    >
      <input type="hidden" name="workLogId" value={workLogId} />

      {open === "edit" && (
        <>
          <div className="flex gap-2">
            <div className="w-[90px]">
              <label className="label" htmlFor={`h-${workLogId}`}>
                Hours
              </label>
              <input
                id={`h-${workLogId}`}
                name="hours"
                type="number"
                step="0.25"
                min="0.25"
                max="24"
                defaultValue={Number(hours).toFixed(2)}
                required
                className="field text-[16px]"
              />
            </div>
            <div className="flex-1">
              <label className="label" htmlFor={`d-${workLogId}`}>
                Date
              </label>
              <input
                id={`d-${workLogId}`}
                name="workDate"
                type="date"
                defaultValue={workDate}
                className="field text-[16px]"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`n-${workLogId}`}>
              What you did
            </label>
            <textarea
              id={`n-${workLogId}`}
              name="internalNotes"
              rows={2}
              defaultValue={notes}
              required
              className="field text-[16px]"
            />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor={`r-${workLogId}`}>
          {open === "edit" ? "Why it is changing" : "Why it is being removed"}
        </label>
        <input
          id={`r-${workLogId}`}
          name="reason"
          required
          minLength={3}
          className="field text-[16px]"
          placeholder={
            open === "edit" ? "Logged 8h, was actually 0.8h" : "Logged twice"
          }
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] font-medium text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={editing || deleting}
          className={
            open === "edit"
              ? "btn-primary py-1.5 text-[11px]"
              : "rounded-lg bg-danger px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
          }
        >
          {open === "edit"
            ? editing
              ? "Saving…"
              : "Save correction"
            : deleting
              ? "Removing…"
              : "Remove entry"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="px-2 text-[11px] font-bold text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
