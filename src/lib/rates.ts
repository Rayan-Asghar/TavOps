/**
 * Which rate applied to a person on the day they did the work.
 *
 * `user_rates` is a history table: a raise is a new row, and an entry logged in
 * July must still cost July's rate after that raise lands. So resolution keys on
 * the work date, never on today.
 *
 * DATE CONVENTION — read this before touching the comparison.
 *
 *   A rate window is HALF-OPEN: [effectiveFrom, effectiveTo).
 *
 * This is the OPPOSITE of `isInvoiced` in `billing-lock.ts`, where
 * `invoiced_through` is INCLUSIVE — "invoiced through the 31st" covers work done
 * on the 31st. Two conventions in one codebase is a real hazard, so both are
 * named at both sites. Half-open is the only convention under which "the old
 * rate ends and the new one begins" is expressible without either a one-day gap
 * or a one-day double-count: the old row's `effectiveTo` and the new row's
 * `effectiveFrom` are the same date, and exactly one of them matches.
 *
 * Granularity is the UTC calendar day. Rates change on a day, not at an instant,
 * and this app already treats the UTC day as the work day everywhere else — the
 * 18:00–02:00 PKT shift is 13:00–21:00 UTC and never crosses a UTC midnight.
 *
 * Pure, and separate from `src/server/costing.ts`, because a `"use server"`
 * module may only export async functions — a predicate cannot live there and
 * still be reachable from a test.
 */

/** A row of `user_rates`, narrowed to what resolution needs. */
export type RateRow = {
  id: string;
  internalCostPerHour: string;
  billableRatePerHour: string | null;
  currency: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type RateResolution =
  | {
      basis: "rated";
      rateId: string;
      internalCostPerHour: string;
      billableRatePerHour: string | null;
      currency: string;
    }
  /** No row covers this date. Amounts are unknowable, and say so. */
  | { basis: "unrated" }
  /** More than one row covers it. Refused, never arbitrated. */
  | { basis: "ambiguous"; rateIds: string[] };

/** The UTC calendar day, as `YYYY-MM-DD`. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRate(rows: RateRow[], workDate: Date): RateResolution {
  const day = utcDay(workDate);

  const covering = rows.filter((r) => {
    const from = utcDay(r.effectiveFrom);
    if (day < from) return false;
    // Half-open at the top: a row ending on the 1st does not cover the 1st.
    return r.effectiveTo === null || day < utcDay(r.effectiveTo);
  });

  if (covering.length === 0) return { basis: "unrated" };

  if (covering.length > 1) {
    // Deliberately not "pick the newest". Picking would make an entry's cost
    // depend on the order rows happened to be inserted in, and a margin nobody
    // can reproduce is worse than a margin that is openly missing. The partial
    // unique index on user_rates should make this unreachable; this is the
    // control, and the index is the backstop.
    return {
      basis: "ambiguous",
      rateIds: covering.map((r) => r.id).sort(),
    };
  }

  const r = covering[0];
  return {
    basis: "rated",
    rateId: r.id,
    internalCostPerHour: r.internalCostPerHour,
    // Nullable in the schema: a person can have a cost and no rate card. That
    // yields cost but no rate-card revenue, carried through as null, not zero.
    billableRatePerHour: r.billableRatePerHour,
    currency: r.currency,
  };
}
