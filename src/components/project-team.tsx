"use client";

import { useActionState, useState } from "react";
import {
  addProjectMember,
  removeProjectMember,
  type MemberState,
} from "@/server/project-members";
import { Badge, type Tone } from "./badges";
import type { ProjectMember } from "@/server/member-queries";

const initial: MemberState = {};

const PROJECT_ROLES = [
  { value: "developer", label: "Developer", hint: "Does the work. Can be assigned tasks." },
  { value: "tech_lead", label: "Technical overseer", hint: "Technical blockers route here." },
  { value: "qa", label: "QA reviewer", hint: "QA blockers and reviews route here." },
  { value: "pm", label: "Project manager", hint: "Scope questions route here." },
  { value: "sales_owner", label: "Client owner", hint: "Client dependencies route here." },
  { value: "observer", label: "Observer", hint: "Can see it, nothing routes here." },
] as const;

const ROLE_TONE: Record<string, Tone> = {
  developer: "neutral",
  tech_lead: "blue",
  qa: "violet",
  pm: "amber",
  sales_owner: "green",
  observer: "neutral",
};

function labelFor(role: string) {
  return PROJECT_ROLES.find((r) => r.value === role)?.label ?? role;
}

export function ProjectTeam({
  projectId,
  members,
  assignable,
  canManage,
}: {
  projectId: string;
  members: ProjectMember[];
  assignable: { id: string; name: string; globalRole: string }[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(addProjectMember, initial);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<string>("developer");
  const now = new Date();

  const developers = members.filter((m) => m.role === "developer").length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">WHO IS ON THIS</p>
          <h3 className="m-0 text-[18px] tracking-[-.035em]">Project team</h3>
        </div>
        <span className="text-[11px] text-fg-muted">
          {members.length} member{members.length === 1 ? "" : "s"}
        </span>
      </div>

      {developers === 0 && canManage && (
        <p className="border-b border-border bg-warn-soft px-5 py-3 text-[11px] text-warn">
          No developers on this project yet, so tasks cannot be assigned to
          anyone. Add someone below.
        </p>
      )}

      <ul className="divide-y divide-border">
        {members.map((m) => {
          const expired = !!m.expiresAt && m.expiresAt <= now;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg text-[10px] font-extrabold text-white">
                {m.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <strong className="text-[12px]">{m.name}</strong>
                <span className="ml-2 text-[10px] text-fg-muted">
                  {m.openTasks > 0
                    ? `${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}`
                    : "no open tasks"}
                </span>
              </div>
              <Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{labelFor(m.role)}</Badge>
              {expired && <Badge tone="red">Access expired</Badge>}
              {m.expiresAt && !expired && (
                <Badge tone="amber">
                  Until {m.expiresAt.toISOString().slice(0, 10)}
                </Badge>
              )}
              {canManage && (
                <form action={removeProjectMember}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="userId" value={m.id} />
                  <button
                    type="submit"
                    disabled={m.openTasks > 0}
                    title={
                      m.openTasks > 0
                        ? "Reassign their open tasks first"
                        : `Remove ${m.name}`
                    }
                    className="text-[11px] font-bold text-fg-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <div className="border-t border-border p-5">
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-secondary py-2 text-[12px]"
            >
              + Add someone
            </button>
          ) : (
            <form action={action} className="space-y-3">
              <input type="hidden" name="projectId" value={projectId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="pm-user">Person</label>
                  <select id="pm-user" name="userId" required defaultValue="" className="field">
                    <option value="" disabled>Pick someone</option>
                    {assignable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.globalRole.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="pm-role">Role on this project</label>
                  <select
                    id="pm-role" name="role" className="field"
                    value={role} onChange={(e) => setRole(e.target.value)}
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* The project role is what blocker routing keys off, so it is
                  spelled out rather than left to be guessed. */}
              <p className="m-0 text-[10px] text-fg-muted">
                {PROJECT_ROLES.find((r) => r.value === role)?.hint}
              </p>

              <div>
                <label className="label" htmlFor="pm-exp">Access expires (optional)</label>
                <input id="pm-exp" name="expiresAt" type="date" className="field" />
                <p className="mt-1 text-[9px] text-fg-subtle">
                  For contractors. Access revokes itself on this date.
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

              <div className="flex gap-2">
                <button type="submit" disabled={pending} className="btn-primary py-2 text-[12px]">
                  {pending ? "Adding…" : "Add to project"}
                </button>
                <button
                  type="button" onClick={() => setAdding(false)}
                  className="px-3 text-[11px] font-bold text-fg-muted"
                >
                  Done
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
