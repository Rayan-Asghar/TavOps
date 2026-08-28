import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, users, workLogs } from "@/db/schema";

/**
 * Who is already committed, and by how much.
 *
 * `users.weekly_capacity_hours` has been on the schema since the beginning and
 * was never read by anything. For an agency bidding on marketplace work, "can
 * we take this job" is the daily question, and it is answerable from data
 * already collected: remaining estimated hours on unfinished assigned tasks,
 * against the hours that person actually has.
 *
 * Deliberately advisory. It warns at handoff; it never blocks a conversion,
 * because a partner deciding to take a job while over capacity is a legitimate
 * business decision and a tool that refuses it just gets worked around.
 */

export type Commitment = {
  userId: string;
  name: string;
  weeklyCapacityHours: number;
  /** Estimated hours still outstanding on unfinished tasks assigned to them. */
  committedHours: number;
  /** Weeks of work already queued, at their stated capacity. */
  weeksBooked: number;
};

export async function commitmentsFor(userIds: string[]): Promise<Commitment[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const people = await db
    .select({
      id: users.id,
      name: users.name,
      weeklyCapacityHours: users.weeklyCapacityHours,
    })
    .from(users)
    .where(inArray(users.id, ids));

  // Remaining work, not total work: a task estimated at 20h with 15h already
  // logged only commits the other 5. Grouped, then merged, so the join to
  // work_logs cannot multiply the estimate rows.
  const estimates = await db
    .select({
      assigneeId: tasks.assigneeId,
      estimated: sql<number>`coalesce(sum(${tasks.estimatedHours}), 0)::float`,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        inArray(tasks.assigneeId, ids),
        ne(tasks.status, "done"),
        ne(projects.lifecycle, "archived"),
        ne(projects.lifecycle, "completed"),
      ),
    )
    .groupBy(tasks.assigneeId);

  const logged = await db
    .select({
      assigneeId: tasks.assigneeId,
      hours: sql<number>`coalesce(sum(${workLogs.hours}), 0)::float`,
    })
    .from(workLogs)
    .innerJoin(tasks, eq(workLogs.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        inArray(tasks.assigneeId, ids),
        ne(tasks.status, "done"),
        isNull(workLogs.deletedAt),
        ne(projects.lifecycle, "archived"),
        ne(projects.lifecycle, "completed"),
      ),
    )
    .groupBy(tasks.assigneeId);

  const est = new Map(estimates.map((r) => [r.assigneeId, r.estimated]));
  const done = new Map(logged.map((r) => [r.assigneeId, r.hours]));

  return people.map((p) => {
    const remaining = Math.max(0, (est.get(p.id) ?? 0) - (done.get(p.id) ?? 0));
    const capacity = p.weeklyCapacityHours || 40;
    return {
      userId: p.id,
      name: p.name,
      weeklyCapacityHours: capacity,
      committedHours: remaining,
      weeksBooked: remaining / capacity,
    };
  });
}

/** Anyone already booked beyond this many weeks is worth mentioning. */
export const BOOKED_WEEKS_WARNING = 2;

export function overCommitted(rows: Commitment[]): Commitment[] {
  return rows.filter((r) => r.weeksBooked > BOOKED_WEEKS_WARNING);
}
