import { SummaryStrip, type SummaryFigure } from "./app-shell";
import { money as fmtMoney, hrs, pct } from "@/lib/format";
import type { ProjectMargin } from "@/server/margin-queries";

/**
 * What the project cost and what it earned.
 *
 * The fourth figure is the honesty cell: hours with no fresh cost. Without it
 * the first three read as complete, when in practice they omit everybody whose
 * rate has not been entered — and a margin that quietly excludes half the team
 * is worse than one that says so.
 */
export function MarginSummary({ margin }: { margin: ProjectMargin }) {
  const { totals, money, suppressed } = margin;
  const uncosted = Number(totals.uncostedHours);

  const figures: SummaryFigure[] = [
    { label: "Hours logged", value: `${hrs(Number(totals.loggedHours))}h` },
    {
      label: "Billable",
      value: `${hrs(Number(totals.billableHours))}h`,
      swatch: "billable" as const,
      note: pct(totals.billableUtilisation) + " of logged",
    },
    {
      label: "Non-billable",
      value: `${hrs(Number(totals.nonBillableHours))}h`,
      swatch: "non-billable" as const,
    },
  ];

  if (money.ok) {
    figures.push(
      {
        label: "Revenue",
        value: fmtMoney(Number(money.revenueAmount), money.currency),
      },
      {
        label: "Cost",
        value: fmtMoney(Number(money.costAmount), money.currency),
      },
      {
        label: "Gross margin",
        value: fmtMoney(Number(money.grossMargin), money.currency),
        note: pct(money.grossMarginPct),
        tone: Number(money.grossMargin) < 0 ? ("danger" as const) : undefined,
      },
    );
  }

  figures.push({
    label: "Not costed",
    value: `${hrs(uncosted)}h`,
    tone: uncosted > 0 ? ("danger" as const) : undefined,
    note: uncosted > 0 ? "no rate covers these" : "all costed",
  });

  return (
    <section className="panel p-5">
      <SummaryStrip figures={figures} />

      {/* Say which rate produced these numbers. With rate history, "at today's
          rate" and "at the rate in force then" are different reports. */}
      <p className="m-0 mt-4 border-t border-border pt-3 text-2xs text-fg-muted">
        Costed at the rate in force on each entry&rsquo;s{" "}
        <strong className="font-bold text-fg">work date</strong>.
      </p>

      {suppressed && (
        <p className="m-0 mt-2 text-2xs text-fg-subtle">
          Cost and margin are hidden on a project with a single contributor —
          the figure would be that person&rsquo;s pay rate.
        </p>
      )}

      {!money.ok && !suppressed && money.reason === "currency-mismatch" && (
        <p className="m-0 mt-2 text-2xs text-warn">
          Costs here are recorded in more than one currency
          ({money.currencies.join(", ")}). Margin needs one currency or an
          exchange rate, and neither exists yet.
        </p>
      )}

      {!money.ok && !suppressed && money.reason === "not-costed" && (
        <p className="m-0 mt-2 text-2xs text-warn">
          Nothing here has a rate yet, so there is no money to show. Set rates
          under People.
        </p>
      )}
    </section>
  );
}
