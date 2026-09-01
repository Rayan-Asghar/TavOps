"use client";

import { useActionState, useState } from "react";
import {
  createTeam,
  addTeamMember,
  removeTeamMember,
  setTeamLead,
  type TeamState,
} from "@/server/team-actions";
import { Badge } from "./badges";
import { FormError, FormSuccess } from "@/components/ui";

const initial: TeamState = {};

export type Person = { id: string; name: string; role: string };
export type TeamView = {
  id: string;
  name: string;
  discipline: string | null;
  leadId: string | null;
  leadName: string | null;
  members: Person[];
};

export function CreateTeamForm({ heads }: { heads: Person[] }) {
  const [state, action, pending] = useActionState(createTeam, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form
      key={state.ok ? "made" : "new"}
      action={action}
      noValidate
      className="panel p-5"
    >
      <h2 className="mb-1 text-lg font-bold">New team</h2>
      <p className="mb-4 text-xs text-fg-muted">
        People can sit in more than one team. A blocker with no project
        specialist goes to their lead.
      </p>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="tm-name">Team name</label>
          <input
            id="tm-name" name="name" required className="field"
            placeholder="Shopify" aria-invalid={!!err.name}
          />
          {err.name && <p className="mt-1 text-xs text-danger">{err.name}</p>}
        </div>
        <div>
          <label className="label" htmlFor="tm-lead">Lead</label>
          <select id="tm-lead" name="leadId" required className="field" defaultValue="">
            <option value="" disabled>Pick a lead</option>
            {heads.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          {err.leadId && <p className="mt-1 text-xs text-danger">{err.leadId}</p>}
        </div>
        <div>
          <label className="label" htmlFor="tm-disc">Discipline</label>
          <input
            id="tm-disc" name="discipline" className="field"
            placeholder="Shopify / Liquid"
          />
        </div>

        {state.error && (
          <FormError>{state.error}</FormError>
        )}
        {state.ok && state.message && (
          <FormSuccess>{state.message}</FormSuccess>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Creating…" : "Create team"}
        </button>
      </div>
    </form>
  );
}

export function TeamCard({
  team,
  everyone,
  heads,
}: {
  team: TeamView;
  everyone: Person[];
  heads: Person[];
}) {
  const [adding, setAdding] = useState(false);
  const memberIds = new Set(team.members.map((m) => m.id));
  const addable = everyone.filter((p) => !memberIds.has(p.id));

  return (
    <li className="panel p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-lg">{team.name}</strong>
            {team.discipline && <Badge tone="neutral">{team.discipline}</Badge>}
          </div>
          <p className="m-0 mt-0.5 text-xs text-fg-muted">
            Led by {team.leadName ?? "nobody"} · {team.members.length} member
            {team.members.length === 1 ? "" : "s"}
          </p>
        </div>

        <form action={setTeamLead} className="flex items-center gap-2">
          <input type="hidden" name="teamId" value={team.id} />
          <label className="sr-only" htmlFor={`lead-${team.id}`}>Change lead</label>
          <select
            id={`lead-${team.id}`}
            name="leadId"
            defaultValue={team.leadId ?? ""}
            className="field-sm font-bold"
          >
            {heads.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-dark btn-xs">
            Set lead
          </button>
        </form>
      </div>

      <ul className="flex flex-wrap gap-2">
        {team.members.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-3 pr-1.5 text-xs"
          >
            <span>{m.name}</span>
            {m.id === team.leadId ? (
              <span className="rounded-full bg-fg px-1.5 py-0.5 text-2xs font-black uppercase tracking-wider text-white">
                Lead
              </span>
            ) : (
              <form action={removeTeamMember}>
                <input type="hidden" name="teamId" value={team.id} />
                <input type="hidden" name="userId" value={m.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${m.name} from ${team.name}`}
                  className="px-1 text-fg-subtle hover:text-danger"
                >
                  ×
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-bold text-brand hover:underline"
          >
            + Add member
          </button>
        ) : (
          <form action={addTeamMember} className="flex flex-wrap gap-2">
            <input type="hidden" name="teamId" value={team.id} />
            <label className="sr-only" htmlFor={`add-${team.id}`}>Add member</label>
            <select
              id={`add-${team.id}`}
              name="userId"
              required
              defaultValue=""
              className="field max-w-[220px]"
            >
              <option value="" disabled>Pick a person</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button type="submit" className="btn-secondary btn-sm">Add</button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="btn-ghost btn-sm"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
