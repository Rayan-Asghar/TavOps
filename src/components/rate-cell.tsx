"use client";

import { useActionState, useState } from "react";
import { setUserRateAction } from "@/server/rate-actions";
import { FormError, FormSuccess } from "./ui";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

export type CurrentRate = {
  internalCostPerHour: string;
  billableRatePerHour: string | null;
  currency: string;
  effectiveFrom: string;
} | null;

/**
 * What a person costs, and the only way in the app to change it.
 *
 * Until this existed, `user_rates` could only be written by `psql` or the seed
 * script — so the whole costing layer reported `unrated` for anyone the seed
 * did not cover, and would have reported it for everyone on a fresh install.
 *
 * A missing rate is called out rather than left blank: it is not a cosmetic
 * gap, it is hours that cost nothing and a project margin that is quietly
 * overstated.
 */
export function RateCell({
  userId,
  userName,
  rate,
}: {
  userId: string;
  userName: string;
  rate: CurrentRate;
}) {
  const [state, action, pending] = useActionState(setUserRateAction, initial);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {rate ? (
          <p className="m-0 text-xs text-fg-muted">
            <span className="font-bold tabular-nums text-fg">
              {rate.currency} {rate.internalCostPerHour}
            </span>
            /h cost
            {rate.billableRatePerHour ? (
              <>
                {" · "}
                <span className="font-bold tabular-nums text-fg">
                  {rate.currency} {rate.billableRatePerHour}
                </span>
                /h billed
              </>
            ) : (
              <span className="text-fg-subtle"> · no rate card</span>
            )}
            <span className="text-fg-subtle"> · since {rate.effectiveFrom}</span>
          </p>
        ) : (
          <p className="m-0 text-xs text-warn">
            No rate set — their hours cost nothing and inflate every margin.
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost btn-sm"
          aria-expanded={open}
        >
          {open ? "Cancel" : rate ? "Change rate" : "Set rate"}
        </button>
      </div>

      {open && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="userId" value={userId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`cost-${userId}`}>
                Internal cost / hour
              </label>
              <input
                id={`cost-${userId}`}
                name="internalCostPerHour"
                inputMode="decimal"
                required
                defaultValue={rate?.internalCostPerHour ?? ""}
                className="field"
                placeholder="12.00"
              />
            </div>
            <div>
              <label className="label" htmlFor={`bill-${userId}`}>
                Billable rate / hour
              </label>
              <input
                id={`bill-${userId}`}
                name="billableRatePerHour"
                inputMode="decimal"
                defaultValue={rate?.billableRatePerHour ?? ""}
                className="field"
                placeholder="45.00"
              />
              {/* Blank is a real answer, and a different one from zero. */}
              <p className="mt-1 text-2xs text-fg-subtle">
                Leave blank if they are not billed out.
              </p>
            </div>
            <div>
              <label className="label" htmlFor={`cur-${userId}`}>
                Currency
              </label>
              <input
                id={`cur-${userId}`}
                name="currency"
                maxLength={3}
                defaultValue={rate?.currency ?? "USD"}
                className="field uppercase"
              />
            </div>
            <div>
              <label className="label" htmlFor={`from-${userId}`}>
                Takes effect
              </label>
              <input
                id={`from-${userId}`}
                name="effectiveFrom"
                type="date"
                required
                defaultValue={today}
                className="field"
              />
            </div>
          </div>

          {/* Said plainly, because the alternative reading — that this edits
              the existing rate — is the one that would quietly restate what
              already-logged work cost. */}
          <p className="m-0 text-2xs text-fg-subtle">
            This opens a new rate from that date. Work already logged keeps the
            rate it was costed at.
          </p>

          {state.error && <FormError>{state.error}</FormError>}
          {state.ok && state.message && (
            <FormSuccess>{state.message}</FormSuccess>
          )}

          <button type="submit" disabled={pending} className="btn-primary btn-sm">
            {pending ? "Saving…" : `Set rate for ${userName}`}
          </button>
        </form>
      )}
    </div>
  );
}
