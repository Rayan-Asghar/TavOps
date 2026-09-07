"use client";

import { useActionState, useState } from "react";
import { recordConnects, reconcileConnects, type ConnectsState } from "@/server/connects-actions";
import {
  KIND_LABEL,
  MANUAL_KINDS,
  type LedgerKind,
} from "@/server/connects-schemas";
import { FormError, FormSuccess, useResetKey } from "@/components/ui";

const initial: ConnectsState = {};

/** Connects arriving or ageing out. Bids are written when a proposal is logged. */
export function RecordConnectsForm() {
  const [state, action, pending] = useActionState(recordConnects, initial);
  const formKey = useResetKey(state);
  const [kind, setKind] = useState<LedgerKind>("purchase");
  const err = state.fieldErrors ?? {};

  return (
    <form key={formKey} action={action} noValidate className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="kind">What happened</label>
          <select
            id="kind"
            name="kind"
            className="field"
            value={kind}
            onChange={(e) => setKind(e.target.value as LedgerKind)}
          >
            {MANUAL_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="count">How many</label>
          <input
            id="count" name="count" type="number" min={1} step={1} required
            className="field" placeholder="60" aria-invalid={!!err.count}
          />
          {err.count && <p className="mt-1 text-xs text-danger">{err.count}</p>}
        </div>
      </div>

      {/* Only a purchase has a price. The database says the same in a CHECK;
          hiding the field means the form cannot get there. */}
      {kind === "purchase" && (
        <div>
          <label className="label" htmlFor="amountUsd">What it cost (USD)</label>
          <input
            id="amountUsd" name="amountUsd" type="number" min={0} step="0.01"
            required className="field" placeholder="9.00"
            aria-invalid={!!err.amountUsd}
          />
          {err.amountUsd && <p className="mt-1 text-xs text-danger">{err.amountUsd}</p>}
        </div>
      )}

      <div>
        <label className="label" htmlFor="note">Note</label>
        <input id="note" name="note" className="field" placeholder="Optional" />
      </div>

      {state.error && <FormError>{state.error}</FormError>}
      {state.ok && state.message && <FormSuccess>{state.message}</FormSuccess>}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Saving…" : "Record"}
      </button>
    </form>
  );
}

/**
 * Squares the ledger against the number Upwork actually shows.
 *
 * The note is required and that is the point: the drift is not absorbed
 * silently, it becomes one row whose delta IS the drift. A ledger that quietly
 * corrects itself is one nobody can audit.
 */
export function ReconcileForm({ balance }: { balance: number }) {
  const [state, action, pending] = useActionState(reconcileConnects, initial);
  const formKey = useResetKey(state);
  const err = state.fieldErrors ?? {};

  return (
    <form key={formKey} action={action} noValidate className="space-y-3">
      <p className="m-0 text-xs text-fg-muted">
        We think there are <strong>{balance}</strong>. Put in what Upwork says
        and the difference is recorded as its own entry.
      </p>
      <div>
        <label className="label" htmlFor="actual">Upwork says</label>
        <input
          id="actual" name="actual" type="number" min={0} step={1} required
          className="field" placeholder={String(balance)}
          aria-invalid={!!err.actual}
        />
        {err.actual && <p className="mt-1 text-xs text-danger">{err.actual}</p>}
      </div>
      <div>
        <label className="label" htmlFor="reconcile-note">Why the difference</label>
        <input
          id="reconcile-note" name="note" required className="field"
          placeholder="Free monthly connects we never recorded"
          aria-invalid={!!err.note}
        />
        {err.note && <p className="mt-1 text-xs text-danger">{err.note}</p>}
      </div>

      {state.error && <FormError>{state.error}</FormError>}
      {state.ok && state.message && <FormSuccess>{state.message}</FormSuccess>}

      <button type="submit" disabled={pending} className="btn-secondary w-full">
        {pending ? "Saving…" : "Reconcile"}
      </button>
    </form>
  );
}
