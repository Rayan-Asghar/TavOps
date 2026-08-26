"use client";

import { useActionState, useState } from "react";
import {
  advanceProposal,
  answerFeasibility,
  type ProposalState,
} from "@/server/proposals";
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
        className="min-h-[30px] rounded-md border border-border bg-surface px-2 text-[10px] font-bold"
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
          className="min-h-[30px] w-[86px] rounded-md border border-border bg-surface px-2 text-[10px]"
        />
      )}
      {next !== status && (
        <button
          type="submit"
          disabled={pending}
          className="min-h-[30px] rounded-md bg-fg px-2.5 text-[10px] font-bold text-white"
        >
          {pending ? "…" : "Save"}
        </button>
      )}
      {state.error && (
        <span role="alert" className="w-full text-right text-[9px] text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Shown to whoever can answer a feasibility request. */
export function FeasibilityAnswer({ proposalId }: { proposalId: string }) {
  const [state, action, pending] = useActionState(answerFeasibility, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[30px] rounded-md border border-warn px-2.5 text-[10px] font-bold text-warn"
      >
        Answer feasibility
      </button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2 rounded-lg bg-surface-2 p-3">
      <input type="hidden" name="proposalId" value={proposalId} />
      <input
        name="note"
        required
        placeholder="e.g. Doable in ~60h, but Klaviyo migration needs scoping."
        className="field"
        aria-label="Feasibility note"
      />
      {state.error && (
        <p role="alert" className="text-[10px] text-danger">{state.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit" name="decision" value="approved" disabled={pending}
          className="min-h-[32px] flex-1 rounded-md bg-ok px-2 text-[10px] font-bold text-white"
        >
          Approve
        </button>
        <button
          type="submit" name="decision" value="rejected" disabled={pending}
          className="min-h-[32px] flex-1 rounded-md bg-danger px-2 text-[10px] font-bold text-white"
        >
          Reject
        </button>
        <button
          type="button" onClick={() => setOpen(false)}
          className="min-h-[32px] px-2 text-[10px] font-bold text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
