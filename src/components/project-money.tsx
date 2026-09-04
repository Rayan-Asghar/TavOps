"use client";

import { useActionState } from "react";
import {
  setProjectMoneyAction,
  upsertRetainerPeriodAction,
} from "@/server/project-money-actions";
import {
  BILLING_MODEL_LABELS,
  BILLING_MODEL_NOTES,
} from "@/server/project-money-schemas";
import { FormError, FormSuccess } from "./ui";
import type { ActionState } from "@/lib/action-state";

const initial: ActionState = {};

export type MoneyPanelProps = {
  projectId: string;
  billingModel: "time_and_materials" | "fixed_fee" | "retainer";
  contractValue: string | null;
  platformFeePct: string | null;
  budgetedHours: string | null;
  currency: string;
  canEdit: boolean;
  periods: {
    periodStart: string;
    periodEnd: string;
    includedHours: string | null;
    amount: string | null;
    rolloverHours: string;
    currency: string;
    loggedHours: string;
  }[];
};

/**
 * The commercial terms of a project, and the first place they can be set.
 *
 * `billing_model` and `retainer_periods` shipped in migration 0019 with no
 * writer anywhere, so a retainer was expressible in the schema and impossible
 * in the product. `project_financials` was written once at proposal handoff and
 * never editable after.
 */
export function ProjectMoney(props: MoneyPanelProps) {
  const [state, action, pending] = useActionState(
    setProjectMoneyAction,
    initial,
  );

  return (
    <section className="panel p-5">
      <p className="eyebrow">Commercial terms</p>
      <h2 className="display m-0 mb-4 text-xl">How this project earns</h2>

      <form action={action} className="space-y-4">
        <input type="hidden" name="projectId" value={props.projectId} />

        <fieldset className="space-y-2" disabled={!props.canEdit}>
          <legend className="label">Billing model</legend>
          {(
            ["time_and_materials", "fixed_fee", "retainer"] as const
          ).map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-3"
            >
              <input
                type="radio"
                name="billingModel"
                value={m}
                defaultChecked={props.billingModel === m}
                className="mt-0.5 h-4 w-4"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold">
                  {BILLING_MODEL_LABELS[m]}
                </span>
                {/* What the choice MEANS for the numbers, so it is made once,
                    knowingly, rather than left on the default. */}
                <span className="block text-2xs text-fg-subtle">
                  {BILLING_MODEL_NOTES[m]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="contractValue"
            label="Contract value"
            defaultValue={props.contractValue ?? ""}
            placeholder="12500.00"
            disabled={!props.canEdit}
            hint="Blank means not agreed yet — which is not the same as zero."
          />
          <Field
            id="budgetedHours"
            label="Budgeted hours"
            defaultValue={props.budgetedHours ?? ""}
            placeholder="160.00"
            disabled={!props.canEdit}
          />
          <Field
            id="platformFeePct"
            label="Platform fee %"
            defaultValue={props.platformFeePct ?? ""}
            placeholder="10"
            disabled={!props.canEdit}
            hint="Taken off the contract once. Never off hourly revenue."
          />
          <Field
            id="currency"
            label="Currency"
            defaultValue={props.currency}
            disabled={!props.canEdit}
          />
        </div>

        {state.error && <FormError>{state.error}</FormError>}
        {state.ok && state.message && <FormSuccess>{state.message}</FormSuccess>}

        {props.canEdit && (
          <button type="submit" disabled={pending} className="btn-primary btn-sm">
            {pending ? "Saving…" : "Save terms"}
          </button>
        )}
      </form>

      {props.billingModel === "retainer" && (
        <RetainerPeriods
          projectId={props.projectId}
          periods={props.periods}
          canEdit={props.canEdit}
          currency={props.currency}
        />
      )}
    </section>
  );
}

function Field({
  id,
  label,
  defaultValue,
  placeholder,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        inputMode="decimal"
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="field"
      />
      {hint && <p className="mt-1 text-2xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

/**
 * A retainer is periodic, so its budget and burn are per period. A lifetime
 * "hours used" on a retainer is a number that means nothing.
 */
function RetainerPeriods({
  projectId,
  periods,
  canEdit,
  currency,
}: {
  projectId: string;
  periods: MoneyPanelProps["periods"];
  canEdit: boolean;
  currency: string;
}) {
  const [state, action, pending] = useActionState(
    upsertRetainerPeriodAction,
    initial,
  );

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="eyebrow">Periods</p>

      {periods.length === 0 ? (
        <p className="m-0 mb-4 text-xs text-fg-muted">
          No periods yet. Until one exists there is nothing to measure this
          month&rsquo;s hours against.
        </p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {periods.map((p) => {
            const allowance =
              p.includedHours === null
                ? null
                : Number(p.includedHours) + Number(p.rolloverHours);
            const used = Number(p.loggedHours);
            const over = allowance !== null && used > allowance;
            return (
              <li
                key={p.periodStart}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
              >
                <span className="font-bold tabular-nums">
                  {p.periodStart} → {p.periodEnd}
                </span>
                <span className="tabular-nums text-fg-muted">
                  {allowance === null ? (
                    <>{used.toFixed(2)}h logged · no allowance set</>
                  ) : (
                    <>
                      <span className={over ? "font-bold text-danger" : "text-fg"}>
                        {used.toFixed(2)}h
                      </span>{" "}
                      of {allowance.toFixed(2)}h
                      {Number(p.rolloverHours) > 0 && (
                        <> (incl. {Number(p.rolloverHours).toFixed(2)}h rollover)</>
                      )}
                      {p.amount && (
                        <>
                          {" · "}
                          {p.currency} {p.amount}
                        </>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="periodStart">
                Period starts
              </label>
              <input
                id="periodStart"
                name="periodStart"
                type="date"
                required
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="periodEnd">
                Period ends
              </label>
              <input
                id="periodEnd"
                name="periodEnd"
                type="date"
                required
                className="field"
              />
            </div>
            <Field
              id="includedHours"
              label="Included hours"
              defaultValue=""
              placeholder="40.00"
            />
            <Field id="amount" label="Amount" defaultValue="" placeholder="2000.00" />
            <Field
              id="rolloverHours"
              label="Rollover in"
              defaultValue=""
              placeholder="0.00"
              hint="Carried from the period before, if that client's contract allows it."
            />
            <Field id="currency" label="Currency" defaultValue={currency} />
          </div>

          {state.error && <FormError>{state.error}</FormError>}
          {state.ok && state.message && (
            <FormSuccess>{state.message}</FormSuccess>
          )}

          <button type="submit" disabled={pending} className="btn-secondary btn-sm">
            {pending ? "Saving…" : "Add or update period"}
          </button>
        </form>
      )}
    </div>
  );
}
