import { and, eq, isNull, or, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import { seesAllProjects, type GlobalRole, type ProjectRole } from "./rbac";

export type Actor = {
  id: string;
  globalRole: GlobalRole;
  accessExpiresAt?: Date | null;
};

export class NotAuthorizedError extends Error {
  constructor(message = "You do not have access to this project.") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/** A temp collaborator past their expiry is treated as having no access at all. */
export function isActorExpired(actor: Actor, now = new Date()): boolean {
  return !!actor.accessExpiresAt && actor.accessExpiresAt <= now;
}

/**
 * The single source of truth for "can this person touch this project".
 *
 * Every fetch-by-id path must go through here. The realistic breach in an
 * internal tool is not an attacker — it is someone changing /projects/12 to
 * /projects/13 out of curiosity, and this is what makes that return a 404.
 */
export async function canAccessProject(
  actor: Actor,
  projectId: string,
): Promise<boolean> {
  if (isActorExpired(actor)) return false;
  if (seesAllProjects(actor.globalRole)) return true;

  const now = new Date();

  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        or(
          eq(projects.pmId, actor.id),
          eq(projects.deliveryLeadId, actor.id),
          eq(projects.salesOwnerId, actor.id),
        ),
      ),
    )
    .limit(1);

  if (owned.length > 0) return true;

  const membership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, actor.id),
        or(
          isNull(projectMembers.expiresAt),
          gt(projectMembers.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  return membership.length > 0;
}

export async function assertProjectAccess(
  actor: Actor,
  projectId: string,
): Promise<void> {
  if (!(await canAccessProject(actor, projectId))) {
    throw new NotAuthorizedError();
  }
}

/**
 * Returns the project ids this actor may see, or `null` meaning "no restriction".
 * Callers fold the null case into their query rather than fetching everything
 * and filtering in JS.
 */
export async function accessibleProjectIds(
  actor: Actor,
): Promise<string[] | null> {
  if (isActorExpired(actor)) return [];
  if (seesAllProjects(actor.globalRole)) return null;

  const now = new Date();

  const [owned, member] = await Promise.all([
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        or(
          eq(projects.pmId, actor.id),
          eq(projects.deliveryLeadId, actor.id),
          eq(projects.salesOwnerId, actor.id),
        ),
      ),
    db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, actor.id),
          or(isNull(projectMembers.expiresAt), gt(projectMembers.expiresAt, now)),
        ),
      ),
  ]);

  return [...new Set([...owned.map((r) => r.id), ...member.map((r) => r.id)])];
}

/** Drizzle predicate for list queries: applies the scope or nothing at all. */
export function projectScopeFilter(ids: string[] | null) {
  if (ids === null) return undefined;
  if (ids.length === 0) return eq(projects.id, "00000000-0000-0000-0000-000000000000");
  return inArray(projects.id, ids);
}

export async function projectRoleOf(
  actor: Actor,
  projectId: string,
): Promise<ProjectRole | null> {
  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, actor.id),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}
