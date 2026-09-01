"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  convertProposalToProject,
  type HandoffState,
} from "@/server/handoff";
import { FormError } from "@/components/ui";

const initial: HandoffState = {};

export type HandoffOption = { id: string; name: string };

/**
 * The sales -> delivery handoff. Everything already known from the proposal is
 * pre-filled; this form asks only for what delivery needs and sales does not
 * have.
 */
export function HandoffForm({
  proposalId,
  suggestedName,
  suggestedType,
  suggestedValue,
  clients,
  leads,
  pms,
}: {
  proposalId: string;
  suggestedName: string;
  suggestedType: string | null;
  suggestedValue: string | null;
  clients: HandoffOption[];
  leads: HandoffOption[];
  pms: HandoffOption[];
}) {
  const [state, action, pending] = useActionState(
    convertProposalToProject,
    initial,
  );
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const err = state.fieldErrors ?? {};

  if (state.ok && state.projectId) {
    return (
      <div className="w-full rounded-lg bg-ok-soft p-3">
        <p className="m-0 text-xs font-bold text-ok">{state.message}</p>
        <Link
          href={`/projects/${state.projectId}`}
          className="mt-1 inline-block text-xs font-bold text-brand hover:underline"
        >
          Open project →
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary btn-xs"
      >
        Convert to project
      </button>
    );
  }

  return (
    <form action={action} noValidate className="w-full space-y-3 rounded-lg bg-surface-2 p-4">
      <input type="hidden" name="proposalId" value={proposalId} />
      <p className="eyebrow m-0">SALES → DELIVERY HANDOFF</p>

      <div>
        <label className="label" htmlFor={`pn-${proposalId}`}>Project name</label>
        <input
          id={`pn-${proposalId}`} name="projectName" required className="field"
          defaultValue={suggestedName} aria-invalid={!!err.projectName}
        />
        {err.projectName && <p className="mt-1 text-xs text-danger">{err.projectName}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`cl-${proposalId}`}>Client</label>
          <select
            id={`cl-${proposalId}`} name="clientId" className="field"
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
            <label className="label" htmlFor={`nc-${proposalId}`}>New client name</label>
            <input
              id={`nc-${proposalId}`} name="newClientName" className="field"
              placeholder="Acme Ltd" aria-invalid={!!err.newClientName}
            />
            {err.newClientName && (
              <p className="mt-1 text-xs text-danger">{err.newClientName}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`pm-${proposalId}`}>Project manager</label>
          <select id={`pm-${proposalId}`} name="pmId" className="field">
            <option value="">— Unassigned —</option>
            {pms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`dl-${proposalId}`}>Delivery lead</label>
          <select id={`dl-${proposalId}`} name="deliveryLeadId" className="field">
            <option value="">— Unassigned —</option>
            {leads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`id-${proposalId}`}>Internal deadline</label>
          <input
            id={`id-${proposalId}`} name="internalDueDate" type="date" className="field"
            aria-invalid={!!err.internalDueDate}
          />
          {err.internalDueDate ? (
            <p className="mt-1 text-xs text-danger">{err.internalDueDate}</p>
          ) : (
            <p className="mt-1 text-2xs text-fg-subtle">Your buffer. Keep it earlier.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor={`cd-${proposalId}`}>Client deadline</label>
          <input id={`cd-${proposalId}`} name="clientDueDate" type="date" className="field" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`ty-${proposalId}`}>Project type</label>
          <input
            id={`ty-${proposalId}`} name="projectType" className="field"
            defaultValue={suggestedType ?? ""} placeholder="Shopify Store Build"
          />
        </div>
        <div>
          <label className="label" htmlFor={`cv-${proposalId}`}>Contract value (USD)</label>
          <input
            id={`cv-${proposalId}`} name="contractValue" type="number" min={0} step="100"
            className="field" defaultValue={suggestedValue ?? ""}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`sc-${proposalId}`}>Scope as promised</label>
        <textarea
          id={`sc-${proposalId}`} name="scope" rows={3} className="field"
          placeholder="What sales committed to. Delivery works from this."
        />
      </div>

      {state.error && (
        <FormError>{state.error}</FormError>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary btn-sm flex-1">
          {pending ? "Creating…" : "Create draft project"}
        </button>
        <button
          type="button" onClick={() => setOpen(false)}
          className="btn-ghost btn-sm"
        >
          Cancel
        </button>
      </div>
      <p className="m-0 text-2xs text-fg-subtle">
        Created as a draft. A PM confirms assets and team before it goes active.
      </p>
    </form>
  );
}
