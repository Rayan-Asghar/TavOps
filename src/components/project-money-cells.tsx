import { BulletBar } from "./charts";
import { money as fmtMoney } from "@/lib/format";
import type { ProjectMoneyRow } from "@/server/margin-queries";

/**
 * Budget · Spent · Cost, on a project row.
 *
 * Harvest puts these on its projects list at the FREE tier, and their absence
 * is most of why Tavren's list read as a task tracker rather than an agency
 * tool: the screen a partner opens first had no money on it at all.
 *
 * The bar is inside the row rather than in a separate chart, which is what
 * makes budget-versus-spent readable at a glance without a dashboard.
 */
export function MoneyCells({
  money,
  logged,
}: {
  money: ProjectMoneyRow | undefined;
  logged: string;
}) {
  const spent = Number(logged);
  const budget = money?.budgetedHours ? Number(money.budgetedHours) : null;
  const over = budget !== null && spent > budget;
  const uncosted = Number(money?.uncostedHours ?? 0);

  return (
    <>
      <td className="tabular px-3 text-right text-fg-muted">
        {budget === null ? <span className="text-fg-subtle">—</span> : `${budget.toFixed(1)}h`}
      </td>
      <td className="px-3">
        <span className="flex items-center gap-2">
          <span className="w-[70px]">
            <BulletBar
              value={spent}
              target={0}
              max={budget && budget > 0 ? budget : spent || 1}
              label="Hours spent against budget"
              valueLabel={
                budget ? `${spent.toFixed(1)} of ${budget.toFixed(1)} hours` : `${spent.toFixed(1)} hours`
              }
              height={4}
            />
          </span>
          <span className={`tabular text-2xs ${over ? "font-bold text-danger" : "text-fg-muted"}`}>
            {budget === null
              ? `${spent.toFixed(1)}h`
              : `${Math.round((spent / budget) * 100)}%`}
          </span>
        </span>
      </td>
      <td className="tabular px-3 text-right">
        {money?.costAmount ? (
          fmtMoney(Number(money.costAmount), money.currency)
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
        {/* Hours with no fresh rated cost. Without this the cost column reads
            as the whole cost, when it may omit most of the team. */}
        {uncosted > 0 && (
          <span className="block text-2xs text-warn" title="Hours with no rate">
            +{uncosted.toFixed(1)}h uncosted
          </span>
        )}
      </td>
    </>
  );
}

/**
 * The same three facts, on a card.
 *
 * The density toggle changes how much fits on a screen; it must never change
 * what is true. A budget visible in list mode and absent in card mode would
 * make the toggle a filter, which is not what a density control is.
 */
export function CardMoney({
  money,
  logged,
}: {
  money: ProjectMoneyRow | undefined;
  logged: string;
}) {
  if (!money) return null;

  const spent = Number(logged);
  const budget = money.budgetedHours ? Number(money.budgetedHours) : null;
  const remaining = budget === null ? null : budget - spent;
  const uncosted = Number(money.uncostedHours);

  return (
    <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4">
      <div>
        <dt className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
          Budget
        </dt>
        <dd className="m-0 tabular text-xs font-bold">
          {budget === null ? "—" : `${budget.toFixed(1)}h`}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
          Remaining
        </dt>
        <dd
          className={`m-0 tabular text-xs font-bold ${
            remaining !== null && remaining < 0 ? "text-danger" : ""
          }`}
        >
          {remaining === null ? "—" : `${remaining.toFixed(1)}h`}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
          Cost
        </dt>
        <dd className="m-0 tabular text-xs font-bold">
          {money.costAmount
            ? fmtMoney(Number(money.costAmount), money.currency)
            : "—"}
        </dd>
        {uncosted > 0 && (
          <dd className="m-0 text-2xs text-warn">
            +{uncosted.toFixed(1)}h uncosted
          </dd>
        )}
      </div>
    </dl>
  );
}
