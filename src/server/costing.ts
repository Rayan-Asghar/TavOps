import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db, withFinanceAccessInTx, type Tx } from "@/db";
import { userRates, workLogCosts, workLogs } from "@/db/schema";
import { assertCan } from "@/lib/rbac";
import { costEntry } from "@/lib/margin";
import { resolveRate, type RateRow } from "@/lib/rates";
import { writeAudit } from "./audit";
import type { Actor } from "@/lib/access";

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
      // Every rate this person has ever had, and NO date filtering in SQL.
      //
      // There used to be a `lte(effectiveFrom, workDate)` bound here "just to
      // keep the result small". It compared INSTANTS while `resolveRate`
      // compares UTC DAYS, so a rate created at 14:32 today excluded work
      // logged at 12:00 today -- the SQL quietly discarded a row the resolver
      // would have accepted, and the entry came back `unrated` with no error.
      //
      // Two implementations of one rule, and the stricter one wins silently.
      // The rule lives in `resolveRate`, which is tested at every boundary;
      // this query's only job is to hand it the candidates. A person has one
      // rate row per raise, so there is nothing to optimise here anyway.
      .where(eq(userRates.userId, input.userId));

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

/**
 * Re-costs entries that were already costed, on purpose and on the record.
 *
 * This is the answer to "the rate was wrong", and it is deliberately an EVENT
 * rather than a side effect. Under read-time resolution, correcting a rate row
 * would silently restate every margin ever reported from it, with nothing to
 * point at afterwards. Here, "we corrected Ayan's July cost rate and re-costed
 * 42 entries" is a row in the audit log with a name and a reason on it.
 *
 * Gated on `rates.view`, not `finance.view`: changing what work is recorded as
 * having cost is a pay-data operation, and `rbac.ts` is explicit that pay data
 * is not granted by inference.
 */
export async function recostWorkLogs(
  workLogIds: string[],
  actor: Actor,
  reason: string,
): Promise<{ costed: number; unrated: number; ambiguous: number }> {
  assertCan(actor.globalRole, "rates.view");
  const ids = [...new Set(workLogIds)];
  if (ids.length === 0) return { costed: 0, unrated: 0, ambiguous: 0 };

  const tally = { costed: 0, unrated: 0, ambiguous: 0 };

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: workLogs.id,
        userId: workLogs.userId,
        projectId: workLogs.projectId,
        workDate: workLogs.workDate,
        hours: workLogs.hours,
        billable: workLogs.billable,
        currentRevisionId: workLogs.currentRevisionId,
      })
      .from(workLogs)
      .where(and(inArray(workLogs.id, ids), isNull(workLogs.deletedAt)));

    for (const row of rows) {
      // A log with no revision head has no chain to anchor a cost to. Seeded
      // fixtures are the only rows in that state; skip rather than invent one.
      if (!row.currentRevisionId) continue;

      const basis = await costWorkLogInTx(tx, {
        workLogId: row.id,
        revisionId: row.currentRevisionId,
        userId: row.userId,
        workDate: row.workDate,
        hours: row.hours,
        billable: row.billable,
      });
      tally[basis === "rated" ? "costed" : basis] += 1;
    }

    // One row for the batch, not one per entry: the operation is the batch.
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "work_log",
      action: "work_log.recost",
      after: { requested: ids.length, ...tally, reason },
    });
  });

  return tally;
}
