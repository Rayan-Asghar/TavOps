"use client";

import { useActionState } from "react";
import { linkProposalClient, type ProposalState } from "@/server/proposals";

const initial: ProposalState = {};

/**
 * Points a proposal at a client we already have.
 *
 * There is no "add a client" option, deliberately. `proposals.client_id` has
 * existed since 0003 with nothing writing it, so a rep bidding on a job for
 * somebody we have already delivered for had no way to know — that is what this
 * fixes. Creating the client stays in the handoff, where a project exists to
 * hang it on: a rep gets visibility of the client list, not ownership of it.
 */
export function ProposalClientLink({
  proposalId,
  clientId,
  clients,
}: {
  proposalId: string;
  clientId: string | null;
  clients: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(linkProposalClient, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="min-w-[180px] flex-1">
        <label className="label" htmlFor="clientId">
          Client
        </label>
        <select
          id="clientId"
          name="clientId"
          defaultValue={clientId ?? ""}
          className="field"
        >
          <option value="">Not linked</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-secondary btn-sm">
        {pending ? "…" : "Save"}
      </button>
      {state.error && (
        <span role="alert" className="w-full text-2xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
