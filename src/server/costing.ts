import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { withFinanceAccessInTx, type Tx } from "@/db";
import { userRates, workLogCosts } from "@/db/schema";
import { costEntry } from "@/lib/margin";
import { resolveRate, type RateRow } from "@/lib/rates";

/**
 * Writes what one work log cost, in the same transaction as the work log.
 *
 * Snapshotted at write time rather than resolved at read time, for three
 * reasons, in order of weight:
 *
 *  1. CONTAINMENT. A read-time join would put `user_rates` inside
 *     `reports.ts::timesheet`, which is shared with /api/reports/timesheet --
 *     the shared helper is exactly what guarantees a CSV can never contain a
 *     row its requester could not see on screen. Opening the finance gate
 *     inside it would widen that gate for every caller, including a developer
 *     downloading their own timesheet.
 *  2. DEFENSIBILITY. A margin reported in September must not quietly become a
 *     different number in November because somebody fixed a typo in a rate row.
 *     If a historical margin has to change, that should be an explicit, audited
 *     re-cost -- something a person can point at.
 *  3. Adding a NEW rate row (the normal case: a raise from 1 October) then
 *     correctly leaves September alone with no effort at all.
 *
 * Not a "use server" module: these are helpers a caller composes into its own
 * transaction, following record-work.ts and work-log-writes.ts.
 */

export type CostWorkLogInput = {
  workLogId: string;
  revisionId: string;
  userId: string;
  workDate: Date;
  hours: string;
  billable: boolean;
};

/**
 * Costs one work log and upserts the row.
 *
 * The caller owns the transaction and the authorization check. Unlike the
 * reporting paths, this one is not gated on a capability: costing is a
 * consequence of work being logged, not a thing a user asks to see. What it
 * writes is protected by RLS; what it reads it reads through the narrow window
 * `withFinanceAccessInTx` opens and closes.
 */
export async function costWorkLogInTx(tx: Tx, input: CostWorkLogInput) {
  return withFinanceAccessInTx(tx, async (sp) => {
    const rows = await sp
      .select({
        id: userRates.id,
        internalCostPerHour: userRates.internalCostPerHour,
        billableRatePerHour: userRates.billableRatePerHour,
        currency: userRates.currency,
        effectiveFrom: userRates.effectiveFrom,
        effectiveTo: userRates.effectiveTo,
      })
      .from(userRates)
      .where(
        and(
          eq(userRates.userId, input.userId),
          lte(userRates.effectiveFrom, input.workDate),
          // The upper bound is half-open, so a row ending on the work date does
          // not cover it. Narrowed here only to keep the result small; the
          // resolver decides, and its boundary tests are the specification.
          or(
            isNull(userRates.effectiveTo),
            gt(userRates.effectiveTo, input.workDate),
          ),
        ),
      );

    const resolved = resolveRate(rows as RateRow[], input.workDate);

    const amounts =
      resolved.basis === "rated"
        ? costEntry({
            hours: input.hours,
            billable: input.billable,
            internalCostPerHour: resolved.internalCostPerHour,
            billableRatePerHour: resolved.billableRatePerHour,
          })
        : // unrated and ambiguous both carry null amounts. A zero-cost entry
          // would inflate margin and look like a fact; null looks like what it
          // is, and Reports counts those hours as "not costed".
          { costAmount: null, revenueAmount: null };

    const values = {
      workLogId: input.workLogId,
      revisionId: input.revisionId,
      basis: resolved.basis,
      rateId: resolved.basis === "rated" ? resolved.rateId : null,
      internalCostPerHour:
        resolved.basis === "rated" ? resolved.internalCostPerHour : null,
      billableRatePerHour:
        resolved.basis === "rated" ? resolved.billableRatePerHour : null,
      currency: resolved.basis === "rated" ? resolved.currency : null,
      costAmount: amounts.costAmount,
      revenueAmount: amounts.revenueAmount,
      costedAt: new Date(),
    };

    // One cost row per work log, replaced wholesale on every edit. The row is
    // a snapshot of the current revision, not a history -- worklog_revisions is
    // the history, and revision_id is the join back to it.
    await sp
      .insert(workLogCosts)
      .values(values)
      .onConflictDoUpdate({ target: workLogCosts.workLogId, set: values });

    return resolved.basis;
  });
}
