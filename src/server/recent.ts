import { and, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, projects } from "@/db/schema";
import { accessibleProjectIds, type Actor } from "@/lib/access";

/**
 * Recently-touched projects, newest first.
 *
 * DESIGN-STANDARD 4.2 r12 makes this required rather than optional: recency and
 * context are two of the three things that make retrieval easy, and NN/g
 * explicitly recommends a "continue where you left off" surface for interrupted
 * work — which is most work here, on a two-person ops team.
 *
 * Derived from the audit log rather than a new `last_opened` column, because the
 * audit log already records every write with an actor and a timestamp, and
 * `audit_log_actor_idx (actor_id, ts)` is exactly the covering index for this
 * query. Recency here means "last thing you *changed*", not "last thing you
 * looked at" — for an ops tool that is the more useful of the two, and it costs
 * no new writes on the read path.
 */
export type RecentProject = {
  id: string;
  code: string;
  name: string;
  health: string;
  at: Date;
};

export async function recentProjectsFor(
  actor: Actor,
  limit = 5,
): Promise<RecentProject[]> {
  const scope = await accessibleProjectIds(actor);
  // `[]` means the actor can see nothing (expired access); `null` means everything.
  if (scope !== null && scope.length === 0) return [];

  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      health: projects.health,
      at: max(auditLog.ts),
    })
    .from(auditLog)
    .innerJoin(projects, eq(projects.id, auditLog.projectId))
    .where(
      and(
        eq(auditLog.actorId, actor.id),
        isNotNull(auditLog.projectId),
        // Archived projects are not somewhere anyone wants to be sent back to.
        sql`${projects.lifecycle} <> 'archived'`,
        scope === null ? undefined : inArray(projects.id, scope),
      ),
    )
    // Grouped aggregate rather than a correlated subquery: PROGRESS.md records
    // that Drizzle only qualifies column names when the query has a join, so a
    // correlated subquery without one silently returns 0. Grouping is immune.
    .groupBy(projects.id, projects.code, projects.name, projects.health)
    .orderBy(desc(max(auditLog.ts)))
    .limit(limit);

  return rows.map((r) => ({ ...r, at: r.at ?? new Date(0) }));
}
