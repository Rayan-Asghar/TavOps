import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import { blockers, clients, projectFinancials, projects, tasks, users, workLogs, worklogRevisions } from "@/db/schema";
import { businessDaysBetween } from "@/lib/business-time";
import type { DateRange } from "@/lib/report-range";

/**
 * Reporting, read-side only.
 *
 * This is the half of the system that replaces the spreadsheets people were
 * keeping by hand: the hours are already in Postgres because work is logged in
 * the app, so a timesheet is a query rather than a document somebody maintains.
 * Nothing here writes, and nothing here talks to an external service — an
 * export is generated from these rows, never synced.
 *
 * Every aggregate is grouped rather than correlated, for the reason spelled out
 * in `digest.ts`: a correlated subquery written against an unjoined outer query
 * silently resolves to a condition that is never true and returns zero with no
 * error.
 *
 * Deleted entries are excluded everywhere. A removed work log is reversed, not
 * erased, so it stays in the table and must be filtered out of every total.
 */

export type { DateRange };

/** `null` scope means "no restriction" — see accessibleProjectIds. */
export type Scope = string[] | null;

/** Impossible id, so an empty scope returns nothing rather than everything. */
const NO_PROJECTS = "00000000-0000-0000-0000-000000000000";

function scoped(scope: Scope): string[] | null {
  if (scope === null) return null;
  return scope.length ? scope : [NO_PROJECTS];
}

/** `to` is an inclusive date; work is stamped through the end of that day. */
function endExclusive(to: Date): Date {
  const out = new Date(to);
  out.setUTCHours(0, 0, 0, 0);
  out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

function rangeFilter(range: DateRange) {
  const from = new Date(range.from);
  from.setUTCHours(0, 0, 0, 0);
  return and(
    gte(workLogs.workDate, from),
    lt(workLogs.workDate, endExclusive(range.to)),
    isNull(workLogs.deletedAt),
  );
}

export type ProjectReportRow = {
  projectId: string;
  code: string;
  name: string;
  clientName: string | null;
  lifecycle: string;
  health: string;
  /** Hours logged inside the reporting window. */
  loggedHours: number;
  /** Hours logged over the project's whole life, for estimate comparison. */
  loggedHoursAllTime: number;
  estimatedHours: number;
  tasksDone: number;
  tasksTotal: number;
  openBlockers: number;
  contributors: number;
};

export async function projectReport(
  range: DateRange,
  scope: Scope,
): Promise<ProjectReportRow[]> {
  const ids = scoped(scope);

  const rows = await db
    .select({
      projectId: projects.id,
      code: projects.code,
      name: projects.name,
      clientName: clients.name,
      lifecycle: projects.lifecycle,
      health: projects.health,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(
      ids === null
        ? ne(projects.lifecycle, "archived")
        : and(ne(projects.lifecycle, "archived"), inArray(projects.id, ids)),
    )
    .orderBy(asc(projects.code));

  const projectIds = rows.map((r) => r.projectId);
  if (projectIds.length === 0) return [];

  const [inRange, allTime, taskAgg, blockerAgg] = await Promise.all([
    db
      .select({
        projectId: workLogs.projectId,
        hours: sql<number>`coalesce(sum(${workLogs.hours}),0)::float`,
        contributors: sql<number>`count(distinct ${workLogs.userId})::int`,
      })
      .from(workLogs)
      .where(and(inArray(workLogs.projectId, projectIds), rangeFilter(range)))
      .groupBy(workLogs.projectId),

    db
      .select({
        projectId: workLogs.projectId,
        hours: sql<number>`coalesce(sum(${workLogs.hours}),0)::float`,
      })
      .from(workLogs)
      .where(
        and(inArray(workLogs.projectId, projectIds), isNull(workLogs.deletedAt)),
      )
      .groupBy(workLogs.projectId),

    db
      .select({
        projectId: tasks.projectId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${eq(tasks.status, "done")})::int`,
        estimated: sql<number>`coalesce(sum(${tasks.estimatedHours}),0)::float`,
      })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds))
      .groupBy(tasks.projectId),

    db
      .select({
        projectId: blockers.projectId,
        open: sql<number>`count(*)::int`,
      })
      .from(blockers)
      .where(
        and(
          inArray(blockers.projectId, projectIds),
          ne(blockers.status, "resolved"),
        ),
      )
      .groupBy(blockers.projectId),
  ]);

  const byRange = new Map(inRange.map((r) => [r.projectId, r]));
  const byAll = new Map(allTime.map((r) => [r.projectId, r.hours]));
  const byTask = new Map(taskAgg.map((r) => [r.projectId, r]));
  const byBlocker = new Map(blockerAgg.map((r) => [r.projectId, r.open]));

  return rows.map((p) => ({
    ...p,
    loggedHours: byRange.get(p.projectId)?.hours ?? 0,
    loggedHoursAllTime: byAll.get(p.projectId) ?? 0,
    estimatedHours: byTask.get(p.projectId)?.estimated ?? 0,
    tasksDone: byTask.get(p.projectId)?.done ?? 0,
    tasksTotal: byTask.get(p.projectId)?.total ?? 0,
    openBlockers: byBlocker.get(p.projectId) ?? 0,
    contributors: byRange.get(p.projectId)?.contributors ?? 0,
  }));
}

export type PersonReportRow = {
  userId: string;
  name: string;
  role: string;
  loggedHours: number;
  /** What this person's stated capacity comes to over the window's work days. */
  capacityHours: number;
  /** loggedHours / capacityHours. Null when capacity is zero. */
  utilisation: number | null;
  projectCount: number;
};

/**
 * Hours logged per person against the capacity they actually had.
 *
 * Capacity is derived from `users.weekly_capacity_hours` spread over the
 * working days in the window, so a part-time person is not measured against a
 * full week and a report covering a fortnight is not compared to one week.
 */
export async function personReport(
  range: DateRange,
  scope: Scope,
): Promise<PersonReportRow[]> {
  const ids = scoped(scope);
  const workDays = businessDaysBetween(range.from, range.to);

  const people = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.globalRole,
      weeklyCapacityHours: users.weeklyCapacityHours,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));

  const logged = await db
    .select({
      userId: workLogs.userId,
      hours: sql<number>`coalesce(sum(${workLogs.hours}),0)::float`,
      projectCount: sql<number>`count(distinct ${workLogs.projectId})::int`,
    })
    .from(workLogs)
    .where(
      ids === null
        ? rangeFilter(range)
        : and(inArray(workLogs.projectId, ids), rangeFilter(range)),
    )
    .groupBy(workLogs.userId);

  const byUser = new Map(logged.map((r) => [r.userId, r]));

  return people
    .map((p) => {
      const row = byUser.get(p.id);
      // Five working days to a week, so the daily rate is capacity/5.
      const capacityHours = (workDays * (p.weeklyCapacityHours || 40)) / 5;
      const loggedHours = row?.hours ?? 0;
      return {
        userId: p.id,
        name: p.name,
        role: p.role,
        loggedHours,
        capacityHours,
        utilisation: capacityHours > 0 ? loggedHours / capacityHours : null,
        projectCount: row?.projectCount ?? 0,
      };
    })
    .sort((a, b) => b.loggedHours - a.loggedHours);
}

export type TimesheetRow = {
  workDate: Date;
  personName: string | null;
  projectCode: string;
  projectName: string;
  taskTitle: string | null;
  hours: number;
  notes: string;
};

/** The line-by-line record. Feeds both the on-screen table and the CSV. */
export async function timesheet(
  range: DateRange,
  scope: Scope,
  opts: { limit?: number; userId?: string | null } = {},
): Promise<TimesheetRow[]> {
  const ids = scoped(scope);

  const conditions = [rangeFilter(range)];
  if (ids !== null) conditions.push(inArray(workLogs.projectId, ids));
  if (opts.userId) conditions.push(eq(workLogs.userId, opts.userId));

  return db
    .select({
      workDate: workLogs.workDate,
      personName: users.name,
      projectCode: projects.code,
      projectName: projects.name,
      taskTitle: tasks.title,
      hours: sql<number>`${workLogs.hours}::float`,
      notes: workLogs.internalNotes,
    })
    .from(workLogs)
    .innerJoin(projects, eq(workLogs.projectId, projects.id))
    .leftJoin(users, eq(workLogs.userId, users.id))
    .leftJoin(tasks, eq(workLogs.taskId, tasks.id))
    .where(and(...conditions))
    .orderBy(desc(workLogs.workDate), asc(projects.code))
    .limit(opts.limit ?? 5000);
}

/**
 * Budgeted hours per project, for the estimate-vs-actual column.
 *
 * Lives behind `withFinanceAccess` because `project_financials` is RLS-guarded
 * and returns nothing outside it. Call ONLY after checking `finance.view` — the
 * policy is a backstop against mistakes, not the permission check itself.
 */
export async function budgetedHoursFor(
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await withFinanceAccess((tx) =>
    tx
      .select({
        projectId: projectFinancials.projectId,
        budgeted: sql<number>`coalesce(${projectFinancials.budgetedHours},0)::float`,
      })
      .from(projectFinancials)
      .where(inArray(projectFinancials.projectId, projectIds)),
  );
  return new Map(rows.map((r) => [r.projectId, r.budgeted]));
}

export type DayHours = { day: string; hours: number };

/**
 * Hours per calendar day across the window, zero-filled.
 *
 * A group-by rather than summing 5,000 timesheet rows in JS, and zero-filled in
 * the same pass because a bar chart with days missing is a lie: a quiet Tuesday
 * and a Tuesday with no entries look identical once the gap closes up.
 *
 * The date is formatted in SQL rather than from a JS `Date`, so the day
 * boundaries match the ones `work_date` was stored against instead of being
 * shifted by the server's timezone.
 */
export async function hoursByDay(
  range: DateRange,
  scope: Scope,
): Promise<DayHours[]> {
  const ids = scoped(scope);
  if (ids !== null && ids.length === 0) return [];

  const rows = await db
    .select({
      day: sql<string>`to_char(${workLogs.workDate}, 'YYYY-MM-DD')`,
      hours: sql<number>`coalesce(sum(${workLogs.hours}),0)::float`,
    })
    .from(workLogs)
    .where(
      ids === null
        ? rangeFilter(range)
        : and(inArray(workLogs.projectId, ids), rangeFilter(range)),
    )
    .groupBy(sql`to_char(${workLogs.workDate}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${workLogs.workDate}, 'YYYY-MM-DD')`);

  const found = new Map(rows.map((r) => [r.day, r.hours]));
  const out: DayHours[] = [];
  const cursor = new Date(range.from);
  // Guard rail: parseRange already caps the window at 400 days.
  for (let i = 0; i < 400 && cursor <= range.to; i++) {
    const day = cursor.toISOString().slice(0, 10);
    out.push({ day, hours: found.get(day) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export type Reconciliation = {
  /** Everything logged in the window. */
  logged: number;
  /** Of that, the hours sitting behind an invoice already sent. */
  invoiced: number;
  /** The rest — work done and not yet charged for. */
  uninvoiced: number;
  /** Entries in the window that have been corrected at least once. */
  correctedEntries: number;
  /** Net hours those corrections moved, signed. */
  correctedHours: number;
};

/**
 * The reconciliation strip's four figures.
 *
 * 2.3 wants Reports to open with three or four numbers that each sum a named
 * section of the detail below, the way Stripe's balance report does. Its example
 * splits on billable/unbilled, which does not exist here and is not going to:
 * Tavren invoices from Wise, there is no payment integration, and no work log
 * carries a billable flag.
 *
 * `projects.invoiced_through` is the honest local equivalent, and it is already
 * load-bearing rather than invented for this — it is the hard stop that prevents
 * editing an entry behind a sent invoice, because restating those hours makes
 * the invoice unexplainable. So "invoiced" means locked and charged, and
 * "not yet invoiced" is the number an agency actually wants: work done that has
 * not been billed.
 *
 * The correction figures are here because 2.3 also warns that a report over a
 * work log with correction history has to say which date it is counting on. This
 * one counts on **entry date** — when the work happened — not on when a
 * correction was filed, and the UI says so.
 */
export async function reconciliation(
  range: DateRange,
  scope: Scope,
): Promise<Reconciliation> {
  const ids = scoped(scope);
  if (ids !== null && ids.length === 0) {
    return { logged: 0, invoiced: 0, uninvoiced: 0, correctedEntries: 0, correctedHours: 0 };
  }

  // A join rather than two passes: "invoiced" is a property of the work log's
  // date against its own project's invoiced_through, so it cannot be decided
  // without the project row.
  const [split] = await db
    .select({
      logged: sql<number>`coalesce(sum(${workLogs.hours}),0)::float`,
      invoiced: sql<number>`coalesce(sum(${workLogs.hours}) filter (
        where ${projects.invoicedThrough} is not null
          and ${workLogs.workDate}::date <= ${projects.invoicedThrough}
      ),0)::float`,
    })
    .from(workLogs)
    .innerJoin(projects, eq(projects.id, workLogs.projectId))
    .where(
      ids === null
        ? rangeFilter(range)
        : and(inArray(workLogs.projectId, ids), rangeFilter(range)),
    );

  // Version > 1 means the entry has been restated at least once. The first
  // revision is the original, not a correction.
  const [corrections] = await db
    .select({
      entries: sql<number>`count(distinct ${worklogRevisions.workLogId})::int`,
      net: sql<number>`coalesce(sum(
        case when ${worklogRevisions.isReversal} then -${worklogRevisions.hours}
             else ${worklogRevisions.hours} end
      ) filter (where ${worklogRevisions.version} > 1),0)::float`,
    })
    .from(worklogRevisions)
    .innerJoin(workLogs, eq(workLogs.id, worklogRevisions.workLogId))
    .where(
      and(
        sql`${worklogRevisions.version} > 1`,
        ids === null
          ? rangeFilter(range)
          : and(inArray(workLogs.projectId, ids), rangeFilter(range)),
      ),
    );

  const logged = split?.logged ?? 0;
  const invoiced = split?.invoiced ?? 0;
  return {
    logged,
    invoiced,
    uninvoiced: Math.max(0, logged - invoiced),
    correctedEntries: corrections?.entries ?? 0,
    correctedHours: corrections?.net ?? 0,
  };
}
