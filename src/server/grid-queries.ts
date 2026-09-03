import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projectMembers,
  projects,
  tasks,
  users,
  workLogs,
} from "@/db/schema";
import { assertProjectAccess, type Actor } from "@/lib/access";
import { assertCan, can, type GlobalRole } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import { rowLock, type RowLock } from "@/lib/grid-permissions";
import { gridTotals, type GridTotals } from "@/lib/grid-totals";
import { monthTabName } from "@/lib/sheet-template";

/**
 * The read side of the work-log grid.
 *
 * A grid is one project for one month — the same slice as a tab of that
 * project's Google sheet, so a block copied out of one pastes back into the
 * other. `?person=` narrows it further for day-to-day logging without changing
 * what the grid is.
 *
 * Kept out of `reports.ts`, whose header states that nothing in it writes: the
 * per-row verdict below is a write-side policy decision, and it does not belong
 * in the reporting module even though it is reached by a select.
 *
 * Read-side conventions, as elsewhere: the caller has already authenticated,
 * the module decides how much to return, and every aggregate is grouped rather
 * than correlated.
 */

/** Row counts are in the tens; this is a runaway guard, not a page size. */
export const GRID_MAX_ROWS = 400;

export type GridRow = {
  id: string;
  /** Optimistic-concurrency token: `work_logs.current_revision_id`. */
  revisionId: string | null;
  /** `YYYY-MM-DD`. Never a Date — it crosses to a client component. */
  workDate: string;
  /** The exact numeric as a string; `2.50` must not become `2.5`. */
  hours: string;
  notes: string;
  personName: string;
  /** A verdict, not an identity: the grid needs to know whose row it is
   *  without being told who everybody is. */
  isMine: boolean;
  taskId: string | null;
  taskTitle: string | null;
  /** True when a timer produced this entry rather than someone typing it. */
  fromTimer: boolean;
  editable: boolean;
  /** Why not, when not. A closed set — never a raw field. */
  lock: RowLock | null;
};

export type GridMonth = {
  /** `YYYY-MM`. */
  month: string;
  /** `August 2026` — character-identical to the sheet's tab name. */
  label: string;
  totalHours: string;
  entries: number;
};

export type WorkGrid = {
  project: { id: string; code: string; name: string; invoicedThrough: string | null };
  month: string;
  monthLabel: string;
  /** The person filter in force, or null for everyone the viewer may see. */
  personId: string | null;
  rows: GridRow[];
  totals: GridTotals;
  months: GridMonth[];
  /** Everyone who could own a row here, for the filter and for paste. */
  people: { id: string; name: string }[];
  /** Open tasks on this project, for the task picker and the timer. */
  assignableTasks: { id: string; title: string }[];
  /** False when the month is past `invoiced_through` in its entirety. */
  monthLocked: boolean;
  canEditOthers: boolean;
  seesEveryone: boolean;
  truncated: boolean;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Every date in this system is a UTC calendar day — see `format.ts`. Built from
 * a literal `T00:00:00.000Z` rather than `new Date("2026-08-01")`, which is
 * parsed as UTC but formats in local time and shifts the day west of it.
 */
export function monthBounds(month: string): { start: Date; next: Date } {
  if (!MONTH_RE.test(month)) {
    throw new UserFacingError("Pick a month to show.");
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const next = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  return { start, next };
}

/** `YYYY-MM` for the month a date falls in. */
export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export async function loadWorkGrid(
  actor: Actor,
  role: GlobalRole,
  input: { projectId: string; personId?: string | null; month: string },
): Promise<WorkGrid> {
  // Access is a fact about the project, so it is checked once for the whole
  // grid rather than per row.
  await assertProjectAccess(actor, input.projectId);

  const seesEveryone = can(role, "worklog.viewAll");
  const canEditOthers = can(role, "worklog.edit");

  // Without worklog.viewAll you see your own entries, whatever the filter says.
  //
  // Asking for somebody else by name is refused here rather than quietly
  // narrowed, so a caller that had no business asking is told so instead of
  // being handed a plausible-looking page — the export route depends on that.
  // The timesheet page narrows before it calls, because there the parameter is
  // only reachable by hand-editing a URL and showing someone their own month is
  // friendlier than an error. Two layers, one rule: nobody sees another
  // person's rows without the capability.
  if (input.personId && input.personId !== actor.id) {
    assertCan(role, "worklog.viewAll");
  }
  const personId = seesEveryone ? (input.personId ?? null) : actor.id;

  const { start, next } = monthBounds(input.month);

  const [project] = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      invoicedThrough: projects.invoicedThrough,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) throw new UserFacingError("That project no longer exists.");

  const scope = [
    eq(workLogs.projectId, input.projectId),
    isNull(workLogs.deletedAt),
    ...(personId ? [eq(workLogs.userId, personId)] : []),
  ];

  const rawRows = await db
    .select({
      id: workLogs.id,
      revisionId: workLogs.currentRevisionId,
      workDate: workLogs.workDate,
      hours: workLogs.hours,
      notes: workLogs.internalNotes,
      userId: workLogs.userId,
      personName: users.name,
      taskId: workLogs.taskId,
      taskTitle: tasks.title,
      // EXISTS rather than a join: two sessions can point at one entry, and a
      // join would then return the row twice.
      fromTimer: sql<boolean>`exists (
        select 1 from time_sessions ts where ts.work_log_id = ${workLogs.id}
      )`,
    })
    .from(workLogs)
    .leftJoin(users, eq(workLogs.userId, users.id))
    .leftJoin(tasks, eq(workLogs.taskId, tasks.id))
    .where(
      and(
        ...scope,
        gte(workLogs.workDate, start),
        lt(workLogs.workDate, next),
      ),
    )
    // The secondary key matters: without it two entries on one day reorder
    // themselves after every save, and the cursor lands somewhere else.
    .orderBy(asc(workLogs.workDate), asc(workLogs.createdAt))
    .limit(GRID_MAX_ROWS + 1);

  const truncated = rawRows.length > GRID_MAX_ROWS;
  const viewer = {
    actorId: actor.id,
    canEditOthers,
    invoicedThrough: project.invoicedThrough,
  };

  const rows: GridRow[] = rawRows.slice(0, GRID_MAX_ROWS).map((r) => {
    const lock = rowLock({ workDate: r.workDate, userId: r.userId }, viewer);
    return {
      id: r.id,
      revisionId: r.revisionId,
      workDate: r.workDate.toISOString().slice(0, 10),
      hours: r.hours,
      notes: r.notes,
      personName: r.personName ?? "—",
      isMine: r.userId === actor.id,
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      fromTimer: r.fromTimer,
      editable: lock === null,
      lock,
      // userId is deliberately absent: on a page where worklog.viewAll may be
      // false, it would say who logged what. The verdict is what the grid needs.
    };
  });

  const [months, people, assignableTasks] = await Promise.all([
    monthsWithEntries(input.projectId, personId),
    projectPeople(input.projectId, seesEveryone ? null : actor.id),
    openTasks(input.projectId),
  ]);

  const lastDay = new Date(next.getTime() - 86_400_000);

  return {
    project,
    month: input.month,
    monthLabel: monthTabName(start),
    personId,
    rows,
    totals: gridTotals(rows),
    months,
    people,
    assignableTasks,
    monthLocked:
      !!project.invoicedThrough &&
      lastDay.toISOString().slice(0, 10) <= project.invoicedThrough,
    canEditOthers,
    seesEveryone,
    truncated,
  };
}

/**
 * The month tabs, with their totals.
 *
 * Grouped rather than correlated, so twelve months of totals cost one query —
 * and because a correlated subquery written against an unjoined outer query
 * resolves to a condition that is never true and returns zero with no error.
 */
export async function monthsWithEntries(
  projectId: string,
  personId: string | null,
): Promise<GridMonth[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${workLogs.workDate}), 'YYYY-MM')`,
      totalHours: sql<string>`to_char(coalesce(sum(${workLogs.hours}), 0), 'FM999999990.00')`,
      entries: sql<number>`count(*)::int`,
    })
    .from(workLogs)
    .where(
      and(
        eq(workLogs.projectId, projectId),
        isNull(workLogs.deletedAt),
        ...(personId ? [eq(workLogs.userId, personId)] : []),
      ),
    )
    .groupBy(sql`date_trunc('month', ${workLogs.workDate})`)
    .orderBy(sql`date_trunc('month', ${workLogs.workDate}) desc`);

  return rows.map((r) => ({
    month: r.month,
    label: monthTabName(new Date(`${r.month}-01T00:00:00.000Z`)),
    totalHours: r.totalHours,
    entries: r.entries,
  }));
}

/**
 * Everyone who could own a row here — for the person filter, and for resolving
 * a name in a pasted block.
 *
 * Membership alone is not enough. A PM, a delivery lead or an admin can log
 * work on a project without ever having a `project_members` row, and a filter
 * that cannot select somebody whose entries are on screen is broken. So this is
 * the union of the project's members and everyone who has actually logged
 * against it.
 */
async function projectPeople(
  projectId: string,
  onlyUserId: string | null,
): Promise<{ id: string; name: string }[]> {
  if (onlyUserId) {
    const [me] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, onlyUserId))
      .limit(1);
    return me ? [me] : [];
  }

  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      or(
        inArray(
          users.id,
          db
            .select({ id: projectMembers.userId })
            .from(projectMembers)
            .where(eq(projectMembers.projectId, projectId)),
        ),
        inArray(
          users.id,
          db
            .selectDistinct({ id: workLogs.userId })
            .from(workLogs)
            .where(
              and(
                eq(workLogs.projectId, projectId),
                isNull(workLogs.deletedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(users.name));

  return rows;
}

async function openTasks(projectId: string) {
  return db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), ne(tasks.status, "done")))
    .orderBy(asc(tasks.orderIndex), asc(tasks.title));
}
