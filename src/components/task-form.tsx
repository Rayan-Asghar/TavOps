"use client";

import { useActionState } from "react";
import { createTask, type TaskState } from "@/server/tasks";

const initial: TaskState = {};

export function TaskForm({
  projectId,
  members,
}: {
  projectId: string;
  members: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createTask, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form
      key={state.ok ? "created" : "new"}
      action={action}
      noValidate
      className="panel p-5"
    >
      <h3 className="mb-1 text-[15px] font-bold">Add a task</h3>
      <p className="mb-4 text-[10px] text-fg-muted">
        Assigning it puts it in that person&rsquo;s inbox straight away.
      </p>
      <input type="hidden" name="projectId" value={projectId} />

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="t-title">Title</label>
          <input
            id="t-title" name="title" required className="field"
            placeholder="PDP template — variant picker"
            aria-invalid={!!err.title}
          />
          {err.title && <p className="mt-1 text-[10px] text-danger">{err.title}</p>}
        </div>

        <div>
          <label className="label" htmlFor="t-assignee">Assign to</label>
          <select id="t-assignee" name="assigneeId" className="field" defaultValue="">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="t-est">Estimate (h)</label>
            <input
              id="t-est" name="estimatedHours" type="number" min={0} step="0.5"
              className="field" placeholder="8"
            />
          </div>
          <div>
            <label className="label" htmlFor="t-due">Due</label>
            <input id="t-due" name="dueDate" type="date" className="field" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="t-priority">Priority</label>
          <select id="t-priority" name="priority" className="field" defaultValue="3">
            <option value="1">1 — highest</option>
            <option value="2">2</option>
            <option value="3">3 — normal</option>
            <option value="4">4</option>
            <option value="5">5 — lowest</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="t-desc">Description</label>
          <textarea
            id="t-desc" name="description" rows={2} className="field"
            placeholder="What done looks like."
          />
        </div>

        <div>
          <label className="label" htmlFor="t-row">Client sheet row</label>
          <input
            id="t-row" name="sheetRowRef" className="field" placeholder="e.g. 4"
          />
          <p className="mt-1 text-[9px] text-fg-subtle">
            Optional. Only used when the client sheet is in update mode.
          </p>
        </div>

        {state.error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] font-medium text-danger">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-[11px] font-medium text-ok">
            {state.message}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Creating…" : "Create task"}
        </button>
      </div>
    </form>
  );
}
