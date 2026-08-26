"use client";

import { useActionState, useEffect, useRef } from "react";
import { reportBlockerFormAction, type FormState } from "@/server/form-actions";

const initial: FormState = {};

const CATEGORIES = [
  { value: "missing_access", label: "Missing access or credentials" },
  { value: "unclear_requirement", label: "Requirement is unclear" },
  { value: "needs_decision", label: "Needs a decision" },
  { value: "waiting_on_client", label: "Waiting on the client" },
  { value: "technical", label: "Technical problem" },
  { value: "other", label: "Something else" },
];

export function BlockerForm({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(reportBlockerFormAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="card p-4">
      <h3 className="mb-1 text-sm font-semibold text-fg">Report a blocker</h3>
      <p className="mb-3 text-xs text-fg-muted">
        Routed automatically. Waiting on the client stops your clock.
      </p>
      <input type="hidden" name="projectId" value={projectId} />

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="b-taskId">Task</label>
          <select id="b-taskId" name="taskId" className="field">
            <option value="">Not task-specific</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="category">What kind</label>
          <select id="category" name="category" className="field" required>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="description">Details</label>
          <textarea
            id="description"
            name="description"
            rows={2}
            required
            className="field"
            placeholder="Need Shopify collaborator access to the live theme."
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" name="isUrgent" className="h-4 w-4 rounded border-border-strong" />
          Urgent — I am fully stopped
        </label>

        {state.error && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="rounded-md bg-ok/10 px-3 py-2 text-sm text-ok ring-1 ring-inset ring-ok/25">
            {state.message}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn-ghost w-full">
          {pending ? "Reporting…" : "Report blocker"}
        </button>
      </div>
    </form>
  );
}
