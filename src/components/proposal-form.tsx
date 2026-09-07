"use client";

import { useActionState } from "react";
import { createProposal, type ProposalState } from "@/server/proposals";
import { FormError, FormSuccess, useResetKey } from "@/components/ui";

const initial: ProposalState = {};

export function ProposalForm() {
  const [state, action, pending] = useActionState(createProposal, initial);
  const formKey = useResetKey(state);
  const err = state.fieldErrors ?? {};

  return (
    <form
      key={formKey}
      action={action}
      noValidate
      className="panel p-5"
    >
      <h2 className="mb-1 text-lg font-bold">Log a proposal</h2>
      <p className="mb-4 text-xs text-fg-muted">
        Takes about ten seconds. Everything downstream is derived from this.
      </p>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="jobTitle">Job title</label>
          <input
            id="jobTitle" name="jobTitle" required className="field"
            placeholder="Shopify store migration"
            aria-invalid={!!err.jobTitle}
          />
          {err.jobTitle && <p className="mt-1 text-xs text-danger">{err.jobTitle}</p>}
        </div>

        <div>
          <label className="label" htmlFor="jobUrl">Job link</label>
          <input
            id="jobUrl" name="jobUrl" type="url" className="field"
            placeholder="https://upwork.com/jobs/…"
            aria-invalid={!!err.jobUrl}
          />
          {err.jobUrl && <p className="mt-1 text-xs text-danger">{err.jobUrl}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input
              id="category" name="category" className="field" list="cats"
              placeholder="Shopify"
            />
            {/* Free text with suggestions: the useful niches are whatever they
                actually bid on, not a list decided up front. */}
            <datalist id="cats">
              <option value="Shopify" /><option value="WordPress" />
              <option value="Automation" /><option value="CRM / GHL" />
              <option value="React / Web App" /><option value="AI / Chatbot" />
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="budgetAmount">Budget (USD)</label>
            <input
              id="budgetAmount" name="budgetAmount" type="number" min={0}
              step="100" className="field" placeholder="4000"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="source">Source</label>
          <select id="source" name="source" className="field" defaultValue="upwork">
            <option value="upwork">Upwork</option>
            <option value="referral">Referral</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </div>

        {/* What the bid cost to place. Written to the ledger in the SAME
            transaction as the proposal: a failure halfway would otherwise
            leave the balance wrong with nothing to point at. Both optional —
            a referral or an inbound lead costs no connects at all. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="connects">Connects spent</label>
            <input
              id="connects" name="connects" type="number" min={0} step={1}
              className="field" placeholder="16"
              aria-invalid={!!err.connects}
            />
            {err.connects && <p className="mt-1 text-xs text-danger">{err.connects}</p>}
          </div>
          <div>
            <label className="label" htmlFor="boost">Boost (extra)</label>
            <input
              id="boost" name="boost" type="number" min={0} step={1}
              className="field" placeholder="0"
              aria-invalid={!!err.boost}
            />
            {err.boost && <p className="mt-1 text-xs text-danger">{err.boost}</p>}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} className="field"
            placeholder="Client wants Klaviyo migration too — unclear scope." />
        </div>

        {state.error && (
          <FormError>{state.error}</FormError>
        )}
        {state.ok && state.message && (
          <FormSuccess>{state.message}</FormSuccess>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving…" : "Log proposal"}
        </button>
      </div>
    </form>
  );
}
