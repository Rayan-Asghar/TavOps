"use client";

import { useActionState } from "react";
import { createProposal, type ProposalState } from "@/server/proposals";

const initial: ProposalState = {};

export function ProposalForm() {
  const [state, action, pending] = useActionState(createProposal, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form
      key={state.ok ? "sent" : "new"}
      action={action}
      noValidate
      className="panel p-5"
    >
      <h2 className="mb-1 text-[15px] font-bold">Log a proposal</h2>
      <p className="mb-4 text-[10px] text-fg-muted">
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
          {err.jobTitle && <p className="mt-1 text-[10px] text-danger">{err.jobTitle}</p>}
        </div>

        <div>
          <label className="label" htmlFor="jobUrl">Job link</label>
          <input
            id="jobUrl" name="jobUrl" type="url" className="field"
            placeholder="https://upwork.com/jobs/…"
            aria-invalid={!!err.jobUrl}
          />
          {err.jobUrl && <p className="mt-1 text-[10px] text-danger">{err.jobUrl}</p>}
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

        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} className="field"
            placeholder="Client wants Klaviyo migration too — unclear scope." />
        </div>

        <label className="flex items-start gap-2 text-[11px]">
          <input type="checkbox" name="needsFeasibility" className="mt-0.5 h-4 w-4" />
          <span>
            Needs a technical read before I bid
            <span className="block text-[9px] text-fg-muted">
              Routes to a delivery lead and shows in their inbox.
            </span>
          </span>
        </label>

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

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving…" : "Log proposal"}
        </button>
      </div>
    </form>
  );
}
