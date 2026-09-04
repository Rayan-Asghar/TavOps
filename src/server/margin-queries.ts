import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import {
  projectFinancials,
  projects,
  retainerPeriods,
  workLogCosts,
  workLogs,
} from "@/db/schema";
import { can, type GlobalRole } from "@/lib/rbac";
import {
  marginMoney,
  marginTotals,
  type GroupRow,
  type MarginMoney,
  type MarginTotals,
} from "@/lib/margin";

/**
 * The money side of reporting.
 *
 * Separate from `reports.ts` for the reason `grid-queries.ts` is separate from
 * it: that module's header promises it is read-side only and opens no external
 * gate, and every function here asserts a capability and opens
 * `withFinanceAccess`. Different contract, different module.
 */

export type ProjectMargin = {
  totals: MarginTotals;
  money: MarginMoney;
  /** Distinct people who logged the hours. Drives the suppression rule below. */
  contributors: number;
  /** True when cost was withheld because it would reveal one person's rate. */
  suppressed: boolean;
};

/**
 * Cost and revenue for one project.
 *
 * THE SINGLE-CONTRIBUTOR RULE. `rbac.ts` states that pay data is not granted by
 * inference. A project cost figure where one person logged all the hours IS
 * that person's rate — divide it by the hours shown next to it. So for a viewer
 * holding `finance.view` but not `rates.view`, cost and margin are withheld
 * when fewer than two people contributed.
 *
 * The count is computed in SQL and the figures are dropped on the server, so a
 * client component is never handed a number it is trusted to hide. This will
 * irritate a head on a solo project; the remedy is one deliberate line in
 * ROLE_CAPABILITIES, not softening the rule here.
 */
export async function projectMargin(
  projectId: string,
  role: GlobalRole,
): Promise<ProjectMargin | null> {
  if (!can(role, "finance.view")) return null;

  const rows = await withFinanceAccess((tx) =>
    tx
      .select({
        hours: workLogs.hours,
        billable: workLogs.billable,
        userId: workLogs.userId,
        // Only a FRESH cost counts. A cost row whose revision is no longer the
        // head describes a version of the entry nobody can see, and treating it
        // as current would report a margin for hours that have since changed.
        costAmount: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.costAmount} end`,
        revenueAmount: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.revenueAmount} end`,
        currency: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.currency} end`,
      })
      .from(workLogs)
      .leftJoin(workLogCosts, eq(workLogCosts.workLogId, workLogs.id))
      .where(
        and(eq(workLogs.projectId, projectId), isNull(workLogs.deletedAt)),
      ),
  );

  const contributors = new Set(rows.map((r) => r.userId)).size;
  const groupRows: GroupRow[] = rows.map((r) => ({
    hours: r.hours,
    billable: r.billable,
    costAmount: r.costAmount,
    revenueAmount: r.revenueAmount,
    currency: r.currency,
  }));

  const totals = marginTotals(groupRows);
  const suppressed = contributors < 2 && !can(role, "rates.view");

  return {
    totals,
    // Hours are never suppressed — only the money that would divide into a rate.
    money: suppressed
      ? { ok: false, reason: "not-costed" }
      : marginMoney(groupRows),
    contributors,
    suppressed,
  };
}

export type ProjectMoneyPanel = {
  billingModel: "time_and_materials" | "fixed_fee" | "retainer";
  contractValue: string | null;
  platformFeePct: string | null;
  budgetedHours: string | null;
  currency: string;
  periods: {
    periodStart: string;
    periodEnd: string;
    includedHours: string | null;
    amount: string | null;
    rolloverHours: string;
    currency: string;
    /** Hours logged INSIDE this period — the only number a retainer's
     *  allowance can honestly be compared against. */
    loggedHours: string;
  }[];
};

/** Everything the money tab needs. Financials and periods are RLS-gated; the
 *  billing model is not, because the project list badges it. */
export async function projectMoneyPanel(
  projectId: string,
  role: GlobalRole,
): Promise<ProjectMoneyPanel | null> {
  if (!can(role, "finance.view")) return null;

  const [project] = await db
    .select({ billingModel: projects.billingModel })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return null;

  return withFinanceAccess(async (tx) => {
    const [fin] = await tx
      .select({
        contractValue: projectFinancials.contractValue,
        platformFeePct: projectFinancials.platformFeePct,
        budgetedHours: projectFinancials.budgetedHours,
        currency: projectFinancials.currency,
      })
      .from(projectFinancials)
      .where(eq(projectFinancials.projectId, projectId))
      .limit(1);

    const periods = await tx
      .select({
        periodStart: retainerPeriods.periodStart,
        periodEnd: retainerPeriods.periodEnd,
        includedHours: retainerPeriods.includedHours,
        amount: retainerPeriods.amount,
        rolloverHours: retainerPeriods.rolloverHours,
        currency: retainerPeriods.currency,
        // Counted per period. A retainer's burn over the project's life is a
        // number that means nothing -- the allowance resets every period.
        loggedHours: sql<string>`(
          SELECT coalesce(sum(w.hours), 0)::text
            FROM work_logs w
           WHERE w.project_id = ${projectId}
             AND w.deleted_at IS NULL
             AND w.work_date::date >= ${retainerPeriods.periodStart}
             AND w.work_date::date <= ${retainerPeriods.periodEnd})`,
      })
      .from(retainerPeriods)
      .where(eq(retainerPeriods.projectId, projectId))
      .orderBy(asc(retainerPeriods.periodStart));

    return {
      billingModel: project.billingModel,
      contractValue: fin?.contractValue ?? null,
      platformFeePct: fin?.platformFeePct ?? null,
      budgetedHours: fin?.budgetedHours ?? null,
      currency: fin?.currency ?? "USD",
      periods,
    };
  });
}

export type ProjectMoneyRow = {
  budgetedHours: string | null;
  contractValue: string | null;
  currency: string;
  /** Cost of the FRESH, rated entries only. Null when nothing is costed. */
  costAmount: string | null;
  /** Hours with no fresh rated cost — the figure that stops the others from
   *  being read as complete. */
  uncostedHours: string;
  contributors: number;
};

/**
 * Budget and cost for a page of projects, in ONE round trip.
 *
 * Deliberately a separate query rather than a join into the projects list.
 * `project_financials` and `work_log_costs` are RLS-forced, and a LEFT JOIN
 * from an ungated query does not error — it silently returns NULL for every
 * one of their columns. That is exactly the "careless future join" the backstop
 * exists to catch, and it would look like "no budgets are set" rather than like
 * a permissions bug.
 */
export async function projectMoneyRows(
  projectIds: string[],
  role: GlobalRole,
): Promise<Map<string, ProjectMoneyRow>> {
  const out = new Map<string, ProjectMoneyRow>();
  if (!can(role, "finance.view") || projectIds.length === 0) return out;

  const seesRates = can(role, "rates.view");

  await withFinanceAccess(async (tx) => {
    const fins = await tx
      .select({
        projectId: projectFinancials.projectId,
        budgetedHours: projectFinancials.budgetedHours,
        contractValue: projectFinancials.contractValue,
        currency: projectFinancials.currency,
      })
      .from(projectFinancials)
      .where(inArray(projectFinancials.projectId, projectIds));

    const costs = await tx
      .select({
        projectId: workLogs.projectId,
        contributors: sql<number>`count(distinct ${workLogs.userId})::int`,
        costAmount: sql<string | null>`sum(
          case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                and ${workLogCosts.basis} = 'rated'
               then ${workLogCosts.costAmount} end)::text`,
        uncostedHours: sql<string>`coalesce(sum(
          case when ${workLogCosts.revisionId} is distinct from ${workLogs.currentRevisionId}
                 or ${workLogCosts.basis} is distinct from 'rated'
               then ${workLogs.hours} end), 0)::text`,
      })
      .from(workLogs)
      .leftJoin(workLogCosts, eq(workLogCosts.workLogId, workLogs.id))
      .where(
        and(
          inArray(workLogs.projectId, projectIds),
          isNull(workLogs.deletedAt),
        ),
      )
      .groupBy(workLogs.projectId);

    const costByProject = new Map(costs.map((c) => [c.projectId, c]));

    for (const id of projectIds) {
      const fin = fins.find((f) => f.projectId === id);
      const cost = costByProject.get(id);
      const contributors = cost?.contributors ?? 0;
      out.set(id, {
        budgetedHours: fin?.budgetedHours ?? null,
        contractValue: fin?.contractValue ?? null,
        currency: fin?.currency ?? "USD",
        // Same single-contributor rule as the project tab: a cost over one
        // person's hours is that person's rate, so it is withheld here too
        // rather than being safe on one screen and not the other.
        costAmount:
          contributors < 2 && !seesRates ? null : (cost?.costAmount ?? null),
        uncostedHours: cost?.uncostedHours ?? "0",
        contributors,
      });
    }
  });

  return out;
}

/**
 * Cost and revenue over a reporting window, for the /reports strip.
 *
 * Scope is the caller's `accessibleProjectIds` — the same list the hours
 * figures above it are built from, so the money describes exactly the rows the
 * reader can see rather than a company total they cannot reconcile.
 */
export async function windowMargin(
  range: { from: Date; to: Date },
  scope: string[] | null,
  role: GlobalRole,
): Promise<ProjectMargin | null> {
  if (!can(role, "finance.view")) return null;
  if (scope !== null && scope.length === 0) return null;

  const from = new Date(range.from);
  from.setUTCHours(0, 0, 0, 0);
  const toExclusive = new Date(range.to);
  toExclusive.setUTCHours(0, 0, 0, 0);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const rows = await withFinanceAccess((tx) =>
    tx
      .select({
        hours: workLogs.hours,
        billable: workLogs.billable,
        userId: workLogs.userId,
        costAmount: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.costAmount} end`,
        revenueAmount: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.revenueAmount} end`,
        currency: sql<
          string | null
        >`case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                 and ${workLogCosts.basis} = 'rated'
            then ${workLogCosts.currency} end`,
      })
      .from(workLogs)
      .leftJoin(workLogCosts, eq(workLogCosts.workLogId, workLogs.id))
      .where(
        and(
          isNull(workLogs.deletedAt),
          gte(workLogs.workDate, from),
          lt(workLogs.workDate, toExclusive),
          scope === null ? undefined : inArray(workLogs.projectId, scope),
        ),
      ),
  );

  const contributors = new Set(rows.map((r) => r.userId)).size;
  const groupRows: GroupRow[] = rows.map((r) => ({
    hours: r.hours,
    billable: r.billable,
    costAmount: r.costAmount,
    revenueAmount: r.revenueAmount,
    currency: r.currency,
  }));

  const suppressed = contributors < 2 && !can(role, "rates.view");
  return {
    totals: marginTotals(groupRows),
    money: suppressed
      ? { ok: false, reason: "not-costed" }
      : marginMoney(groupRows),
    contributors,
    suppressed,
  };
}

/**
 * Which work logs in a window have no fresh, rated cost.
 *
 * Resolved here, behind the finance gate, and handed to `timesheet()` as a
 * plain id list. The alternative -- a NOT EXISTS against `work_log_costs`
 * inside `timesheet()` -- looks equivalent and is not: that helper runs
 * ungated, so the subquery sees zero rows through RLS and the filter matches
 * EVERY entry. It would not error; the "not costed" drill-down would simply
 * show the whole timesheet.
 */
export async function uncostedWorkLogIds(
  range: { from: Date; to: Date },
  scope: string[] | null,
  role: GlobalRole,
): Promise<string[]> {
  if (!can(role, "finance.view")) return [];
  if (scope !== null && scope.length === 0) return [];

  const from = new Date(range.from);
  from.setUTCHours(0, 0, 0, 0);
  const toExclusive = new Date(range.to);
  toExclusive.setUTCHours(0, 0, 0, 0);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const rows = await withFinanceAccess((tx) =>
    tx
      .select({ id: workLogs.id })
      .from(workLogs)
      .leftJoin(workLogCosts, eq(workLogCosts.workLogId, workLogs.id))
      .where(
        and(
          isNull(workLogs.deletedAt),
          gte(workLogs.workDate, from),
          lt(workLogs.workDate, toExclusive),
          scope === null ? undefined : inArray(workLogs.projectId, scope),
          sql`(${workLogCosts.workLogId} IS NULL
               OR ${workLogCosts.revisionId} IS DISTINCT FROM ${workLogs.currentRevisionId}
               OR ${workLogCosts.basis} IS DISTINCT FROM 'rated')`,
        ),
      ),
  );
  return rows.map((r) => r.id);
}

/**
 * Revenue and cost per client, scoped to the projects the reader can see.
 *
 * Scoped deliberately: a client total built from projects the reader cannot
 * open would be a number they have no way to reconcile, and on a page listing
 * who the agency works for it would also leak the size of engagements they are
 * not on.
 */
export async function clientMoneyRows(
  clientIds: string[],
  scope: string[] | null,
  role: GlobalRole,
): Promise<
  Map<string, { revenueAmount: string | null; costAmount: string | null; currency: string }>
> {
  const out = new Map<
    string,
    { revenueAmount: string | null; costAmount: string | null; currency: string }
  >();
  if (!can(role, "finance.view") || clientIds.length === 0) return out;
  if (scope !== null && scope.length === 0) return out;

  const seesRates = can(role, "rates.view");

  await withFinanceAccess(async (tx) => {
    const rows = await tx
      .select({
        clientId: projects.clientId,
        contributors: sql<number>`count(distinct ${workLogs.userId})::int`,
        costAmount: sql<string | null>`sum(
          case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                and ${workLogCosts.basis} = 'rated'
               then ${workLogCosts.costAmount} end)::text`,
        revenueAmount: sql<string | null>`sum(
          case when ${workLogCosts.revisionId} = ${workLogs.currentRevisionId}
                and ${workLogCosts.basis} = 'rated'
               then ${workLogCosts.revenueAmount} end)::text`,
        currency: sql<string>`coalesce(max(${workLogCosts.currency}), 'USD')`,
      })
      .from(workLogs)
      .innerJoin(projects, eq(projects.id, workLogs.projectId))
      .leftJoin(workLogCosts, eq(workLogCosts.workLogId, workLogs.id))
      .where(
        and(
          isNull(workLogs.deletedAt),
          inArray(projects.clientId, clientIds),
          scope === null ? undefined : inArray(workLogs.projectId, scope),
        ),
      )
      .groupBy(projects.clientId);

    for (const r of rows) {
      if (!r.clientId) continue;
      // Same single-contributor rule as everywhere else: a cost over one
      // person's hours is that person's rate, whichever screen it appears on.
      const hide = r.contributors < 2 && !seesRates;
      out.set(r.clientId, {
        revenueAmount: r.revenueAmount,
        costAmount: hide ? null : r.costAmount,
        currency: r.currency,
      });
    }
  });

  return out;
}
