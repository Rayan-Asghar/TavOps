"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reportBlockerFormAction, type FormState } from "@/server/form-actions";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type BlockerCategory,
} from "@/lib/blocker-routing";

const initial: FormState = {};

/** Grouped so the reporter picks by "who owns this", which is what routing
 *  keys off — a flat list of thirteen invites the wrong choice. */
const GROUPS: { label: string; items: BlockerCategory[] }[] = [
  {
    label: "Waiting on the client",
    items: ["missing_access", "missing_asset", "client_approval", "waiting_on_client"],
  },
  {
    label: "Scope & requirements",
    items: ["unclear_requirement", "scope_conflict", "needs_decision", "commercial_scope"],
  },
  {
    label: "Delivery",
    items: ["technical", "qa_issue", "dependency_dev", "production_incident"],
  },
  { label: "Other", items: ["other"] },
];

/** Told to the reporter before they submit, so routing is never a black box. */
const ROUTE_HINT: Record<BlockerCategory, string> = {
  missing_access: "Goes to whoever owns client communication. Stops your clock.",
  missing_asset: "Goes to whoever owns client communication. Stops your clock.",
  client_approval: "Goes to whoever owns client communication. Stops your clock.",
  waiting_on_client: "Goes to whoever owns client communication. Stops your clock.",
  unclear_requirement: "Goes to the PM, delivery lead copied.",
  scope_conflict: "Goes to the PM, delivery lead copied.",
  needs_decision: "Goes to the PM, delivery lead copied.",
  commercial_scope: "Goes to the deal owner, PM copied.",
  technical: "Goes to the project's technical overseer.",
  qa_issue: "Goes to the project's reviewer.",
  dependency_dev: "Goes to that developer, their lead copied.",
  production_incident: "Goes to the delivery lead and PM immediately. Always critical.",
  other: "Goes to the delivery lead.",
};

export function BlockerForm({
  projectId,
  tasks,
  members,
}: {
  projectId: string;
  tasks: { id: string; title: string }[];
  members: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(reportBlockerFormAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<BlockerCategory>("missing_access");

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const isIncident = category === "production_incident";
  const isDependency = category === "dependency_dev";

  return (
    <form ref={formRef} action={action} className="panel p-5">
      <h3 className="mb-1 text-[15px] font-bold">Report a blocker</h3>
      <p className="mb-4 text-[10px] text-fg-muted">
        Routed by what kind of problem it is, not broadcast to everyone.
      </p>
      <input type="hidden" name="projectId" value={projectId} />

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="b-taskId">Task</label>
          <select id="b-taskId" name="taskId" className="field">
            <option value="">Not task-specific</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="category">What kind of problem</label>
          <select
            id="category"
            name="category"
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value as BlockerCategory)}
          >
            {GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] text-fg-muted">{ROUTE_HINT[category]}</p>
        </div>

        {isDependency && (
          <div>
            <label className="label" htmlFor="blockedOnUserId">
              Waiting on which developer
            </label>
            <select
              id="blockedOnUserId"
              name="blockedOnUserId"
              required
              className="field"
              defaultValue=""
            >
              <option value="" disabled>Pick a person</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label" htmlFor="severity">How stuck are you</label>
          <select
            id="severity"
            name="severity"
            className="field"
            defaultValue="normal"
            disabled={isIncident}
          >
            {(Object.keys(SEVERITY_LABELS) as (keyof typeof SEVERITY_LABELS)[]).map(
              (s) => (
                <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
              ),
            )}
          </select>
          {isIncident ? (
            <p className="mt-1 text-[10px] text-danger">
              Production incidents are always critical — one hour to respond.
            </p>
          ) : (
            <p className="mt-1 text-[9px] text-fg-subtle">
              Sets how long the owner has to respond: 16h / 8h / 4h / 1h.
            </p>
          )}
          {/* Kept in the payload when the select is disabled. */}
          {isIncident && <input type="hidden" name="severity" value="critical" />}
        </div>

        <div>
          <label className="label" htmlFor="description">Details</label>
          <textarea
            id="description" name="description" rows={2} required className="field"
            placeholder="Need Shopify collaborator access to the live theme."
          />
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

        <button type="submit" disabled={pending} className="btn-secondary w-full">
          {pending ? "Reporting…" : "Report blocker"}
        </button>
      </div>
    </form>
  );
}
