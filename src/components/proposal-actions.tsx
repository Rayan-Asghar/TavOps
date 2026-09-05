"use client";

import { useActionState, useState } from "react";
import { advanceProposal, type ProposalState } from "@/server/proposals";
import { markChased } from "@/server/proposals";
import {
  LOST_REASON_LABEL,
  LOST_REASONS,
  PROPOSAL_STATUSES,
  STATUS_LABEL,
} from "@/server/proposal-schemas";

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
    <form action={action} className="flex flex-wrap items-center gap-1.5">
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
      {/* Only when moving TO lost. A loss with no reason is the row that
          teaches nothing, which is the only reason to record losses at all. */}
      {next === "lost" && (
        <select
          name="lostReason"
          required
          defaultValue=""
          aria-label="Why it was lost"
          className="field-sm"
        >
          <option value="" disabled>
            Why?
          </option>
          {LOST_REASONS.map((r) => (
            <option key={r} value={r}>
              {LOST_REASON_LABEL[r]}
            </option>
          ))}
        </select>
      )}
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
        <span role="alert" className="w-full text-2xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * "I chased them."
 *
 * The only write the chase queue needs, and it asks for nothing: no date, no
 * note, no plan. It records that a chase happened, which restarts the clock in
 * `lib/chase.ts` and clears the inbox line. That is the whole distinction
 * between this and the follow-up column migration 0011 removed.
 */
export function MarkChased({
  proposalId,
  chaseCount,
}: {
  proposalId: string;
  chaseCount: number;
}) {
  const [state, action, pending] = useActionState(markChased, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="proposalId" value={proposalId} />
      <button type="submit" disabled={pending} className="btn-secondary btn-xs">
        {pending ? "…" : "I chased them"}
      </button>
      {chaseCount > 0 && (
        <span className="text-2xs text-fg-muted">
          {chaseCount === 1 ? "chased once" : `chased ${chaseCount} times`}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-2xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
