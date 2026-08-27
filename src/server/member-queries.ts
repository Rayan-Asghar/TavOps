import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, tasks, users } from "@/db/schema";

/**
 * Read side of project membership. Not a "use server" module: exported async
 * functions in one become callable actions, and these take ids.
 */

export type ProjectMember = {
  id: string;
  name: string;
  globalRole: string;
  role: string;
  expiresAt: Date | null;
  openTasks: number;
};

export async function projectMembersFor(
  projectId: string,
): Promise<ProjectMember[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      globalRole: users.globalRole,
      role: projectMembers.role,
      expiresAt: projectMembers.expiresAt,
      // Surfaced so the UI can explain why someone cannot be removed yet.
      openTasks: sql<number>`(
        select count(*)::int from ${tasks}
         where ${tasks.projectId} = ${projectId}
           and ${tasks.assigneeId} = ${users.id}
           and ${tasks.status} <> 'done')`,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.role), asc(users.name));
}

/** Everyone who could be added, i.e. active staff not already on the project. */
export async function assignableStaff(projectId: string) {
  const onProject = db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));

  return db
    .select({ id: users.id, name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        sql`${users.id} not in ${onProject}`,
      ),
    )
    .orderBy(asc(users.name));
}
