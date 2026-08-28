"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { logWorkFormAction, type FormState } from "@/server/form-actions";

const initial: FormState = {};

export type QuickLogTask = {
  taskId: string | null;
  projectId: string;
  projectName: string;
  projectCode: string;
  title: string;
  status: string;
  estimatedHours: string | null;
  loggedHours: string;
};

/**
 * One task, one tap, one log.
 *
 * Collapsed until it is opened so a person with nine tasks sees a list rather
 * than nine forms. Opening one reveals only the three things that have to be
 * typed — hours, what you did, and optionally the client line — because this is
 * used on a phone at 1am and every extra field is a reason not to bother.
 */
export function QuickLogRow({ task }: { task: QuickLogTask }) {
  const [state, action, pending] = useActionState(logWorkFormAction, initial);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Collapse on success so the list reads as "done" rather than staying open
  // with stale values in it.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [state.ok]);

  const estimate = task.estimatedHours ? Number(task.estimatedHours) : null;
  const logged = Number(task.loggedHours || 0);
  // Overrun is the earliest honest warning on fixed-price work, and it costs
  // nothing to show here: the hours are already being entered.
  const over = estimate !== null && estimate > 0 && logged > estimate * 1.25;

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left min-h-[56px] hover:bg-surface-2"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">
            {task.title}
          </span>
          <span className="mt-0.5 block text-[10px] text-fg-muted">
            {task.projectCode} · {task.projectName}
            {estimate !== null && (
              <span className={over ? "text-danger font-bold" : ""}>
                {" "}· {logged.toFixed(1)}h of {estimate.toFixed(1)}h
                {over ? " — over estimate" : ""}
              </span>
            )}
          </span>
        </span>
        <span className="text-[11px] font-bold text-fg-muted">
          {open ? "Close" : "Log"}
        </span>
      </button>

      {open && (
        <form ref={formRef} action={action} className="space-y-3 px-4 pb-4">
          <input type="hidden" name="projectId" value={task.projectId} />
          {task.taskId && (
            <input type="hidden" name="taskId" value={task.taskId} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`h-${task.taskId ?? task.projectId}`}>
                Hours
              </label>
              <input
                id={`h-${task.taskId ?? task.projectId}`}
                name="hours"
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0.25"
                max="24"
                required
                className="field text-[16px]"
                placeholder="3"
              />
            </div>
            <div>
              <label className="label" htmlFor={`s-${task.taskId ?? task.projectId}`}>
                Move to
              </label>
              <select
                id={`s-${task.taskId ?? task.projectId}`}
                name="resultingStatus"
                className="field text-[16px]"
              >
                <option value="">Leave as-is</option>
                <option value="in_progress">In progress</option>
                <option value="in_review">Ready for review</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor={`n-${task.taskId ?? task.projectId}`}>
              What you did <span className="text-fg-subtle">(internal)</span>
            </label>
            <textarea
              id={`n-${task.taskId ?? task.projectId}`}
              name="internalNotes"
              rows={2}
              required
              className="field text-[16px]"
              placeholder="Variant picker done. Gallery still rough on mobile."
            />
          </div>

          <div>
            <label className="label" htmlFor={`c-${task.taskId ?? task.projectId}`}>
              Line for the client <span className="text-fg-subtle">(optional)</span>
            </label>
            <input
              id={`c-${task.taskId ?? task.projectId}`}
              name="clientUpdate"
              maxLength={300}
              className="field text-[16px]"
              placeholder="Product page work under way."
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
          {state.ok && state.message && (
            <p className="rounded-lg bg-ok-soft px-3 py-2 text-[11px] font-medium text-ok">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="btn-primary w-full min-h-[44px]"
          >
            {pending ? "Saving…" : "Log it"}
          </button>
        </form>
      )}
    </li>
  );
}
