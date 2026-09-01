import { aliasedTable, and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import {
  blockers,
  clients,
  projectFinancials,
  projects,
  tasks,
  users,
  workLogs,
} from "@/db/schema";
import type { Actor } from "@/lib/access";
import { can, type GlobalRole } from "@/lib/rbac";
import { projectMembersFor, assignableStaff } from "./member-queries";
import { unresolvedCount } from "./notifications";

/**
 * Everything the project detail page reads, in one place.
 *
 * Read side only, and not a `"use server"` module — the page was ~660 lines
 * with its queries interleaved with its markup, which made both harder to
 * follow than either is on its own.
 *
 * The caller has already checked access; this assumes it. What it does decide
 * is *how much* to read, because two of these queries narrow by capability and
 * that decision belongs next to the query it changes, not in the JSX.
 */

export type ProjectDetail = Awaited<ReturnType<typeof loadProjectDetail>>;

export async function loadProjectDetail(actor: Actor, projectId: string) {
  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [project] = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      description: projects.description,
      health: projects.health,
      lifecycle: projects.lifecycle,
      projectType: projects.projectType,
      internalDueDate: projects.internalDueDate,
      clientDueDate: projects.clientDueDate,
      clientName: clients.name,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return null;

  const role = (me?.globalRole ?? "developer") as GlobalRole;
  const seesAllActivity = can(role, "worklog.viewAll");
  const canManageMembers = can(role, "project.manageMembers");

  // Second alias so the reporter and the assignee can be joined in one query.
  const assignee = aliasedTable(users, "assignee");

  const [taskRows, blockerRows, activityRows, teamList, addableStaff, count] =
    await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          dueDate: tasks.dueDate,
          estimatedHours: tasks.estimatedHours,
          assigneeId: tasks.assigneeId,
          assigneeName: users.name,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(eq(tasks.projectId, projectId))
        .orderBy(tasks.orderIndex, tasks.title),

      db
        .select({
          id: blockers.id,
          description: blockers.description,
          category: blockers.category,
          ownerSide: blockers.ownerSide,
          severity: blockers.severity,
          escalationLevel: blockers.escalationLevel,
          createdAt: blockers.createdAt,
          reportedBy: users.name,
          assignedToName: assignee.name,
        })
        .from(blockers)
        .leftJoin(users, eq(blockers.reportedById, users.id))
        .leftJoin(assignee, eq(blockers.assignedToId, assignee.id))
        .where(
          and(eq(blockers.projectId, projectId), ne(blockers.status, "resolved")),
        )
        .orderBy(desc(blockers.severity), desc(blockers.createdAt)),

      // Deleted entries are reversed, not erased, so every read filters them.
      db
        .select({
          id: workLogs.id,
          hours: workLogs.hours,
          notes: workLogs.internalNotes,
          workDate: workLogs.workDate,
          userId: workLogs.userId,
          userName: users.name,
          taskTitle: tasks.title,
        })
        .from(workLogs)
        .leftJoin(users, eq(workLogs.userId, users.id))
        .leftJoin(tasks, eq(workLogs.taskId, tasks.id))
        .where(
          seesAllActivity
            ? and(eq(workLogs.projectId, projectId), isNull(workLogs.deletedAt))
            : and(
                eq(workLogs.projectId, projectId),
                eq(workLogs.userId, actor.id),
                isNull(workLogs.deletedAt),
              ),
        )
        .orderBy(desc(workLogs.workDate))
        .limit(40),

      projectMembersFor(projectId),
      canManageMembers ? assignableStaff(projectId) : Promise.resolve([]),
      unresolvedCount(actor.id),
    ]);

  // Whole-project total, independent of what this person may read row by row —
  // an hours total is not sensitive, individual entries are. The same holds for
  // the date of the last entry: "nothing has moved in nine days" is the thing a
  // sales owner needs before the client says it, and a bare date discloses no
  // note, no author and no duration.
  const [totals] = await db
    .select({
      hours: sql<string>`coalesce(sum(${workLogs.hours}),0)::text`,
      lastMovementAt: sql<Date | null>`max(${workLogs.workDate})`,
    })
    .from(workLogs)
    .where(and(eq(workLogs.projectId, projectId), isNull(workLogs.deletedAt)));

  // Money is fetched only when the role allows it, and only inside the RLS
  // opt-in. Without both, the query returns nothing.
  const finance = can(role, "finance.view")
    ? await withFinanceAccess(async (tx) => {
        const [row] = await tx
          .select()
          .from(projectFinancials)
          .where(eq(projectFinancials.projectId, projectId))
          .limit(1);
        return row ?? null;
      })
    : null;

  return {
    me,
    role,
    project,
    taskRows,
    blockerRows,
    activityRows,
    teamList,
    addableStaff,
    inboxCount: count,
    totals,
    finance,
    seesAllActivity,
    canManageMembers,
  };
}

/**
 * Just enough to title a browser tab. Separate from `loadProjectDetail`
 * because `generateMetadata` runs alongside the page render and should not
 * repeat its dozen queries to produce one string.
 */
export async function projectTitle(projectId: string) {
  const [row] = await db
    .select({ code: projects.code, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}
