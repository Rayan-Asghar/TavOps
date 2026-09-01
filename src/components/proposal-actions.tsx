"use client";

import { useActionState, useState } from "react";
import { advanceProposal, type ProposalState } from "@/server/proposals";
import { PROPOSAL_STATUSES, STATUS_LABEL } from "@/server/proposal-schemas";

const initial: ProposalState = {};

/** Inline status move. Won asks for the value, because a win with no number
 *  cannot be told apart from a win worth nothing. */
export function AdvanceStatus({
  proposalId,
  status,
}: {
  proposalId: string;
  status: string;
}) {
  const [state, action, pending] = useActionState(advanceProposal, initial);
  const [next, setNext] = useState(status);

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="proposalId" value={proposalId} />
      <select
        name="status"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        aria-label="Proposal status"
        className="field-sm font-bold"
      >
        {PROPOSAL_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
      {/* Only when moving TO won; an already-won row has its value. */}
      {next === "won" && status !== "won" && (
        <input
          name="wonValue"
          type="number"
          min={0}
          step="100"
          required
          placeholder="Value"
          aria-label="Won value"
          className="field-sm w-[86px]"
        />
      )}
      {next !== status && (
        <button
          type="submit"
          disabled={pending}
          className="btn-dark btn-xs"
        >
          {pending ? "…" : "Save"}
        </button>
      )}
      {state.error && (
        <span role="alert" className="w-full text-right text-2xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
