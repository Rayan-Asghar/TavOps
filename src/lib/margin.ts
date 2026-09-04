/**
 * What work cost, what it earned, and the difference.
 *
 * ARITHMETIC. Every amount is handled in integer minor units — cents — using
 * the idiom `grid-totals.ts` already defends: `Math.round(Number(x) * 100)`.
 * A column of small amounts added as floats drifts; `numeric(12,2)` has no
 * fractional cents to lose, so the conversion is exact both ways.
 *
 * ROUNDING HAPPENS ONCE, PER WORK LOG, at costing time, and never again on an
 * aggregate. That is what makes a figure in the reconciliation strip *literally*
 * the sum of the rows its drill-down shows. Rounding a total independently of
 * its parts is how a strip stops adding up, and a strip that does not add up is
 * worth less than no strip.
 *
 * NULL IS NOT ZERO, anywhere in this file. A ratio with no denominator is
 * `null`, matching `format.ts::pct` ("null is 'not applicable', not zero") and
 * the existing `personReport` utilisation. `0` and `Infinity` both read as
 * facts; `null` reads as "we do not know", which is the truth.
 *
 * Pure — no database, no `@/db` import — so every identity below is testable
 * without Postgres.
 */

/** An amount as stored: an exact decimal string, or null for "not knowable". */
export type Amount = string | null;

export function toCents(amount: Amount): number | null {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function fromCents(cents: number | null): Amount {
  return cents === null ? null : (cents / 100).toFixed(2);
}

/* ------------------------------------------------------------------ *
 * Per entry — computed once, at costing time, and stored
 * ------------------------------------------------------------------ */

export type EntryCostInput = {
  hours: string;
  billable: boolean;
  internalCostPerHour: string;
  billableRatePerHour: string | null;
};

export type EntryCost = { costAmount: Amount; revenueAmount: Amount };

/**
 * Cost applies to non-billable hours too, and that is the entire point of the
 * exercise: a two-hour internal meeting costs money and earns none. A model
 * that only costs billable time is the model Tavren had before this, which
 * could not see where the money went.
 */
export function costEntry(e: EntryCostInput): EntryCost {
  const hoursCentis = Math.round(Number(e.hours) * 100);
  const costRate = Math.round(Number(e.internalCostPerHour) * 100);
  // hundredths-of-an-hour x cents-per-hour = cents x 100.
  const costAmount = Math.round((hoursCentis * costRate) / 100);

  let revenueAmount: number | null;
  if (!e.billable) {
    // Genuinely zero: the work happened and no one is being charged for it.
    revenueAmount = 0;
  } else if (e.billableRatePerHour === null) {
    // Billable, but there is no rate card to value it at. Unknown, not zero.
    revenueAmount = null;
  } else {
    const rate = Math.round(Number(e.billableRatePerHour) * 100);
    revenueAmount = Math.round((hoursCentis * rate) / 100);
  }

  return {
    costAmount: fromCents(costAmount),
    revenueAmount: fromCents(revenueAmount),
  };
}

/* ------------------------------------------------------------------ *
 * Per group — project, person, client, or a whole date window
 * ------------------------------------------------------------------ */

export type GroupRow = {
  hours: string;
  billable: boolean;
  /** Null when the entry has no fresh `rated` cost row. */
  costAmount: Amount;
  revenueAmount: Amount;
  /** The currency the cost was recorded in; null when uncosted. */
  currency: string | null;
};

export type MarginTotals = {
  loggedHours: string;
  billableHours: string;
  nonBillableHours: string;
  costedHours: string;
  uncostedHours: string;
  billableUtilisation: number | null;
};

export type MarginMoney =
  | {
      ok: true;
      currency: string;
      costAmount: string;
      revenueAmount: string;
      grossMargin: string;
      grossMarginPct: number | null;
      /** Revenue over ALL hours: what was earned per hour it actually took. */
      effectiveRate: string | null;
      /** Revenue over billable hours only: the rate card in practice. */
      billedRate: string | null;
    }
  /**
   * Refused, not approximated. With no exchange-rate table, an implicit 1:1
   * conversion is a wrong number that looks right — and someone will price the
   * next job off it. Refusing is cheap; the fix is a decision a human makes.
   */
  | { ok: false; reason: "currency-mismatch"; currencies: string[] }
  /** Nothing in the group carries a fresh cost, so there is no money to show. */
  | { ok: false; reason: "not-costed" };

const centis = (h: string) => Math.round(Number(h) * 100);
const hrs = (c: number) => (c / 100).toFixed(2);

export function marginTotals(rows: readonly GroupRow[]): MarginTotals {
  let billable = 0;
  let nonBillable = 0;
  let costed = 0;

  for (const r of rows) {
    const h = centis(r.hours);
    if (r.billable) billable += h;
    else nonBillable += h;
    if (r.costAmount !== null) costed += h;
  }

  const logged = billable + nonBillable;
  return {
    loggedHours: hrs(logged),
    billableHours: hrs(billable),
    nonBillableHours: hrs(nonBillable),
    costedHours: hrs(costed),
    uncostedHours: hrs(logged - costed),
    billableUtilisation: logged === 0 ? null : billable / logged,
  };
}

export function marginMoney(rows: readonly GroupRow[]): MarginMoney {
  const costed = rows.filter((r) => r.costAmount !== null);
  if (costed.length === 0) return { ok: false, reason: "not-costed" };

  const currencies = [
    ...new Set(costed.map((r) => r.currency).filter((c): c is string => !!c)),
  ].sort();
  if (currencies.length > 1) {
    return { ok: false, reason: "currency-mismatch", currencies };
  }

  let cost = 0;
  let revenue = 0;
  let billableH = 0;
  let loggedH = 0;

  for (const r of costed) {
    cost += toCents(r.costAmount) ?? 0;
    // A billable entry with no rate card contributes hours but no revenue.
    revenue += toCents(r.revenueAmount) ?? 0;
    const h = centis(r.hours);
    loggedH += h;
    if (r.billable) billableH += h;
  }

  const margin = revenue - cost;
  return {
    ok: true,
    currency: currencies[0] ?? "USD",
    costAmount: fromCents(cost)!,
    revenueAmount: fromCents(revenue)!,
    grossMargin: fromCents(margin)!,
    grossMarginPct: revenue === 0 ? null : margin / revenue,
    effectiveRate:
      loggedH === 0 ? null : fromCents(Math.round((revenue * 100) / loggedH)),
    billedRate:
      billableH === 0 ? null : fromCents(Math.round((revenue * 100) / billableH)),
  };
}

/* ------------------------------------------------------------------ *
 * Against the contract
 * ------------------------------------------------------------------ */

export type ContractInput = {
  contractValue: Amount;
  /** Percent, as stored: "10.00" means 10%. */
  platformFeePct: Amount;
  budgetedHours: Amount;
};

export type ContractView = {
  contractAmount: Amount;
  platformFee: Amount;
  netContract: Amount;
  /** Net contract less cost. On fixed-price work this is the real money. */
  contractMargin: Amount;
  budgetBurn: number | null;
  remainingBudgetHours: Amount;
};

/**
 * `platformFeePct` applies ONCE, to the contract value, and never to rate-card
 * revenue: a platform fee levied on hours that were never invoiced through the
 * platform is fiction.
 *
 * Contract margin and rate-card margin answer different questions and are never
 * added or blended. On a project with a contract value, contract margin is the
 * money; rate-card revenue beside it is what tells you whether the price was
 * right.
 */
export function contractView(
  c: ContractInput,
  costAmount: Amount,
  loggedHours: string,
): ContractView {
  const contract = toCents(c.contractValue);
  if (contract === null) {
    // No contract value: there is no contract margin, as opposed to a margin
    // measured against zero. Budget burn still works on its own.
    return {
      contractAmount: null,
      platformFee: null,
      netContract: null,
      contractMargin: null,
      ...budgetPart(c.budgetedHours, loggedHours),
    };
  }

  // Null fee is arithmetically 0 but renders as "no fee recorded", not "0%".
  const feePct = c.platformFeePct === null ? null : Number(c.platformFeePct);
  const fee = feePct === null ? 0 : Math.round((contract * feePct) / 100);
  const net = contract - fee;
  const cost = toCents(costAmount);

  return {
    contractAmount: fromCents(contract),
    platformFee: c.platformFeePct === null ? null : fromCents(fee),
    netContract: fromCents(net),
    contractMargin: cost === null ? null : fromCents(net - cost),
    ...budgetPart(c.budgetedHours, loggedHours),
  };
}

function budgetPart(budgetedHours: Amount, loggedHours: string) {
  const budget = budgetedHours === null ? null : centis(budgetedHours);
  if (budget === null || budget === 0) {
    // Null means "not applicable", so the whole budget block goes null rather
    // than reporting a burn of zero against a budget that does not exist.
    return { budgetBurn: null, remainingBudgetHours: null };
  }
  const logged = centis(loggedHours);
  return {
    budgetBurn: logged / budget,
    // May be negative, and should be: overrun is the interesting direction.
    remainingBudgetHours: hrs(budget - logged),
  };
}
