import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, projects, tasks, users, workLogs } from "@/db/schema";
import { businessHoursBetween } from "@/lib/business-time";
import type { Digest, ProjectLine } from "@/lib/digest-format";

/**
 * The daily digest.
 *
 * "Nobody knows status without asking" is not solved by a dashboard, because a
 * dashboard still has to be visited. This renders the same answer as plain text
 * so it can be pushed into whichever channel each person actually reads.
 *
 * Every line is derived from data already collected. Nothing here asks anyone
 * to maintain a status field, because a status field people must remember to
 * update is exactly the thing that goes stale and then lies.
 */

const STALE_BLOCKER_HOURS = 24; // business hours, so ~3 shifts

function hoursSince(d: Date | null, now: Date): number | null {
  return d ? businessHoursBetween(d, now) : null;
}

export async function buildDigest(now = new Date()): Promise<Digest> {
  const active = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      health: projects.health,
    })
    .from(projects)
    .where(eq(projects.lifecycle, "active"))
    .orderBy(projects.code);

  const ids = active.map((p) => p.id);

  /**
   * Grouped aggregates, not correlated subqueries.
   *
   * Two reasons. It is three queries instead of one per project, which matters
   * at fifteen projects sharing a 60s cron budget. And a correlated subquery
   * written as sql`... where ${tasks.projectId} = ${projects.id}` is only
   * correct by accident: drizzle qualifies column names as "tasks"."project_id"
   * when the outer query has a join and as a bare "project_id" when it does
   * not, and the bare form silently resolves to tasks.project_id = tasks.id —
   * a condition that is never true, returning 0 with no error. Grouping keeps
   * every column reference unambiguous.
   */
  const taskAgg = ids.length
    ? await db
        .select({
          projectId: tasks.projectId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${eq(tasks.status, "done")})::int`,
          overdue: sql<number>`count(*) filter (
            where ${ne(tasks.status, "done")} and ${tasks.dueDate} < now())::int`,
          estimated: sql<string>`coalesce(sum(${tasks.estimatedHours}),0)::text`,
        })
        .from(tasks)
        .where(inArray(tasks.projectId, ids))
        .groupBy(tasks.projectId)
    : [];

  const workAgg = ids.length
    ? await db
        .select({
          projectId: workLogs.projectId,
          logged: sql<string>`coalesce(sum(${workLogs.hours}),0)::text`,
          lastAt: sql<Date | null>`max(${workLogs.loggedAt})`,
        })
        .from(workLogs)
        .where(and(inArray(workLogs.projectId, ids), isNull(workLogs.deletedAt)))
        .groupBy(workLogs.projectId)
    : [];

  const blockerAgg = ids.length
    ? await db
        .select({
          projectId: blockers.projectId,
          open: sql<number>`count(*)::int`,
        })
        .from(blockers)
        .where(
          and(inArray(blockers.projectId, ids), ne(blockers.status, "resolved")),
        )
        .groupBy(blockers.projectId)
    : [];

  const byTask = new Map(taskAgg.map((r) => [r.projectId, r]));
  const byWork = new Map(workAgg.map((r) => [r.projectId, r]));
  const byBlocker = new Map(blockerAgg.map((r) => [r.projectId, r]));

  const lines: ProjectLine[] = active.map((p) => {
    const t = byTask.get(p.id);
    const w = byWork.get(p.id);
    return {
      code: p.code,
      name: p.name,
      health: p.health,
      doneTasks: t?.done ?? 0,
      totalTasks: t?.total ?? 0,
      overdueTasks: t?.overdue ?? 0,
      estimatedHours: Number(t?.estimated ?? 0),
      loggedHours: Number(w?.logged ?? 0),
      openBlockers: byBlocker.get(p.id)?.open ?? 0,
      lastActivityAt: w?.lastAt ? new Date(w.lastAt) : null,
    };
  });

  // Blockers that have been sitting long enough to be costing money.
  const stuckRows = await db
    .select({
      projectName: projects.name,
      projectCode: projects.code,
      description: blockers.description,
      ownerSide: blockers.ownerSide,
      createdAt: blockers.createdAt,
      assignee: users.name,
    })
    .from(blockers)
    .innerJoin(projects, eq(blockers.projectId, projects.id))
    .leftJoin(users, eq(blockers.assignedToId, users.id))
    .where(
      and(
        ne(blockers.status, "resolved"),
        lt(blockers.createdAt, new Date(now.getTime() - 12 * 3600_000)),
      ),
    )
    .orderBy(blockers.createdAt);

  const stuckBlockers = stuckRows
    .map((b) => ({
      project: `${b.projectCode} ${b.projectName}`,
      description: b.description,
      assignee: b.assignee,
      hoursOpen: Math.round(businessHoursBetween(b.createdAt, now)),
      ownerSide: b.ownerSide,
    }))
    .filter((b) => b.hoursOpen >= STALE_BLOCKER_HOURS);

  // A project nobody has logged against in over a full shift. This is the
  // "work slips and we find out late" signal that needs nobody to report
  // anything: silence is the symptom.
  const silentProjects = lines.filter((p) => {
    const h = hoursSince(p.lastActivityAt, now);
    return h === null || h > 8;
  });

  return { generatedAt: now, projects: lines, stuckBlockers, silentProjects };
}

export { renderDigest } from "@/lib/digest-format";
export type { Digest, ProjectLine } from "@/lib/digest-format";
