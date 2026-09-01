"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createProject, type ProjectState } from "@/server/project-actions";
import { FormError } from "@/components/ui";

const initial: ProjectState = {};

export function ProjectForm({
  clients,
  pms,
  leads,
  salesPeople,
  developers,
}: {
  clients: { id: string; name: string }[];
  pms: { id: string; name: string }[];
  leads: { id: string; name: string }[];
  salesPeople: { id: string; name: string }[];
  developers: { id: string; name: string; globalRole: string }[];
}) {
  const [state, action, pending] = useActionState(createProject, initial);
  const [clientId, setClientId] = useState("");
  const router = useRouter();
  const err = state.fieldErrors ?? {};

  if (state.ok && state.projectId) {
    router.push(`/projects/${state.projectId}`);
  }

  return (
    <form action={action} noValidate className="panel max-w-[720px] p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Project name</label>
          <input
            id="name" name="name" required className="field"
            placeholder="Northwind Shopify Rebuild" aria-invalid={!!err.name}
          />
          {err.name && <p className="mt-1 text-xs text-danger">{err.name}</p>}
        </div>

        <div>
          <label className="label" htmlFor="clientId">Client</label>
          <select
            id="clientId" name="clientId" className="field"
            value={clientId} onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">— New client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {clientId === "" && (
          <div>
            <label className="label" htmlFor="newClientName">New client name</label>
            <input
              id="newClientName" name="newClientName" className="field"
              placeholder="Acme Ltd" aria-invalid={!!err.newClientName}
            />
            {err.newClientName && (
              <p className="mt-1 text-xs text-danger">{err.newClientName}</p>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="projectType">Type</label>
          <input
            id="projectType" name="projectType" className="field"
            placeholder="Shopify Store Build"
          />
        </div>
        <div>
          <label className="label" htmlFor="pmId">Project manager</label>
          <select id="pmId" name="pmId" className="field">
            <option value="">— Unassigned —</option>
            {pms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="deliveryLeadId">Delivery lead</label>
          <select id="deliveryLeadId" name="deliveryLeadId" className="field">
            <option value="">— Unassigned —</option>
            {leads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="salesOwnerId">Sales owner</label>
          <select id="salesOwnerId" name="salesOwnerId" className="field">
            <option value="">— None —</option>
            {salesPeople.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="internalDueDate">Internal deadline</label>
          <input
            id="internalDueDate" name="internalDueDate" type="date" className="field"
            aria-invalid={!!err.internalDueDate}
          />
          {err.internalDueDate ? (
            <p className="mt-1 text-xs text-danger">{err.internalDueDate}</p>
          ) : (
            <p className="mt-1 text-2xs text-fg-subtle">
              Your buffer. Developers only ever see this one.
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="clientDueDate">Client deadline</label>
          <input id="clientDueDate" name="clientDueDate" type="date" className="field" />
        </div>

        <div className="sm:col-span-2">
          <span className="label">Developers on this project</span>
          {/* Without at least one, no task on the project can be assigned to
              anyone, so this is asked for up front rather than discovered. */}
          <div className="grid gap-1.5 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-2">
            {developers.length === 0 && (
              <p className="m-0 text-xs text-fg-muted">
                No developers exist yet. Create accounts under People first.
              </p>
            )}
            {developers.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="developerIds"
                  value={d.id}
                  className="h-4 w-4"
                />
                <span>{d.name}</span>
                <span className="text-2xs text-fg-subtle">
                  {d.globalRole.replace(/_/g, " ")}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-2xs text-fg-subtle">
            You can add or change people later from the project page.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="description">Scope</label>
          <textarea
            id="description" name="description" rows={3} className="field"
            placeholder="What is being delivered."
          />
        </div>
      </div>

      {state.error && (
        <FormError>{state.error}</FormError>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Creating…" : "Create project"}
        </button>
        <p className="m-0 text-xs text-fg-subtle">
          Created as a draft until you set it active.
        </p>
      </div>
    </form>
  );
}
