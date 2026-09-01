"use client";

import { useActionState, useEffect, useRef } from "react";
import { logWorkFormAction, type FormState } from "@/server/form-actions";
import { FormError, FormSuccess } from "@/components/ui";

const initial: FormState = {};

export function LogWorkForm({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(logWorkFormAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields on success so a second entry does not resubmit the first.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">Log work</h3>
      <input type="hidden" name="projectId" value={projectId} />

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="taskId">Task</label>
          <select id="taskId" name="taskId" className="field">
            <option value="">General project work (no task)</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="hours">Hours</label>
            <input
              id="hours"
              name="hours"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              required
              className="field"
              placeholder="6"
            />
          </div>
          <div>
            <label className="label" htmlFor="resultingStatus">Move to</label>
            <select id="resultingStatus" name="resultingStatus" className="field">
              <option value="">Leave status as-is</option>
              <option value="in_progress">In progress</option>
              <option value="in_review">Ready for review</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="internalNotes">
            What you did
          </label>
          <textarea
            id="internalNotes"
            name="internalNotes"
            rows={2}
            required
            className="field"
            placeholder="Hero section done — desktop and mobile. Nav still flaky on Safari."
          />
          <p className="mt-1 text-xs text-fg-subtle">
            Write it for your reviewer.
          </p>
        </div>

        {state.error && (
          <FormError>{state.error}</FormError>
        )}
        {state.ok && state.message && (
          <FormSuccess>{state.message}</FormSuccess>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving…" : "Log work"}
        </button>
      </div>
    </form>
  );
}
