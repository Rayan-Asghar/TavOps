"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blockers, projectMembers, projects, tasks } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { addBusinessHours } from "@/lib/business-time";
import {
  resolveBlockerRouting,
  type BlockerCategory,
  type BlockerSeverity,
} from "@/lib/blocker-routing";
import { notify, resolveByDedupeKey } from "./notifications";
import {
  reportBlockerSchema,
  resolveBlockerSchema,
  type ReportBlockerInput,
  type ResolveBlockerInput,
} from "./schemas";
import { UserFacingError } from "@/lib/errors";


/**
 * Reporting a blocker is the single most valuable action in this system, so it
 * is deliberately cheap: category, a sentence, done. Routing and deadlines are
 * derived, never asked for.
 *
 * Client-owned blockers route to the sales owner rather than the delivery lead,
 * and mark the task as waiting rather than counting against the developer. A
 * developer stuck on a client who has not sent product photos has not failed at
 * anything, and the system should never imply otherwise.
 */
export async function reportBlocker(input: ReportBlockerInput) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "blocker.create");

  const data = reportBlockerSchema.parse(input);
  await assertProjectAccess(actor, data.projectId);

  const created = await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);
    if (!project) throw new UserFacingError("Project not found.");

    if (data.taskId) {
      const [task] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, data.taskId), eq(tasks.projectId, data.projectId)))
        .limit(1);
      if (!task)
        throw new UserFacingError("Task does not belong to that project.");
    }

    // Project-scoped role holders outrank the project-level defaults, so a
    // project with its own technical overseer or QA reviewer routes to them.
    const members = await tx
      .select({ userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, data.projectId));

    const byRole: Record<string, string | null> = {};
    for (const m of members) if (!byRole[m.role]) byRole[m.role] = m.userId;

    const routing = resolveBlockerRouting({
      category: data.category as BlockerCategory,
      severity: data.severity as BlockerSeverity,
      reporterId: actor.id,
      project: {
        pmId: project.pmId,
        deliveryLeadId: project.deliveryLeadId,
        salesOwnerId: project.salesOwnerId,
      },
      projectRoles: {
        tech_lead: byRole.tech_lead,
        qa: byRole.qa,
        sales_owner: byRole.sales_owner,
        pm: byRole.pm,
      },
      blockedOnUserId: data.blockedOnUserId ?? null,
    });

    const [blocker] = await tx
      .insert(blockers)
      .values({
        projectId: data.projectId,
        taskId: data.taskId ?? null,
        reportedById: actor.id,
        assignedToId: routing.assigneeId,
        category: data.category,
        severity: data.severity,
        blockedOnUserId: data.blockedOnUserId ?? null,
        ownerSide: routing.ownerSide,
        description: data.description,
        isUrgent: data.severity === "critical" || data.severity === "high",
        slaDueAt: addBusinessHours(new Date(), routing.slaHours),
        routingRule: routing.rule,
        watcherIds: routing.watcherIds,
      })
      .returning();

    if (data.taskId) {
      await tx
        .update(tasks)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(tasks.id, data.taskId));
    }

    // The assignee owns it; watchers are told but the clock is not on them.
    if (routing.assigneeId && routing.assigneeId !== actor.id) {
      await notify(
        {
          userId: routing.assigneeId,
          kind: "blocker_opened",
          title: `${data.severity === "critical" ? "CRITICAL — " : ""}Blocked: ${project.name}`,
          body: `${data.description}\n\n${routing.explanation}`,
          projectId: data.projectId,
          taskId: data.taskId ?? null,
          blockerId: blocker.id,
          isActionable: true,
          dedupeKey: `blocker:${blocker.id}`,
        },
        tx,
      );
    }

    for (const watcher of routing.watcherIds) {
      await notify(
        {
          userId: watcher,
          kind: "blocker_opened",
          title: `FYI — blocked: ${project.name}`,
          body: `${data.description}\n\nYou are copied, not accountable.`,
          projectId: data.projectId,
          taskId: data.taskId ?? null,
          blockerId: blocker.id,
          isActionable: false,
          dedupeKey: `blocker_cc:${blocker.id}:${watcher}`,
        },
        tx,
      );
    }

    return blocker;
  });

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/");
  return created;
}

export async function resolveBlocker(input: ResolveBlockerInput) {
  const actor = await requireActor();
  const data = resolveBlockerSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const [blocker] = await tx
      .select()
      .from(blockers)
      .where(eq(blockers.id, data.blockerId))
      .limit(1);
    if (!blocker) throw new UserFacingError("Blocker not found.");

    // The assignee can always clear their own item even without the global
    // capability — otherwise a sales rep could never unblock what was routed
    // to them.
    const isAssignee = blocker.assignedToId === actor.id;
    if (!isAssignee) assertCan(actor.globalRole, "blocker.resolve");
    await assertProjectAccess(actor, blocker.projectId);

    await tx
      .update(blockers)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolutionNote: data.resolutionNote,
      })
      .where(eq(blockers.id, blocker.id));

    // Return the task to play only if nothing else is still blocking it.
    if (blocker.taskId) {
      const stillBlocked = await tx
        .select({ id: blockers.id })
        .from(blockers)
        .where(
          and(
            eq(blockers.taskId, blocker.taskId),
            eq(blockers.status, "open"),
          ),
        )
        .limit(1);

      if (stillBlocked.length === 0) {
        await tx
          .update(tasks)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(tasks.id, blocker.taskId));
      }
    }

    if (blocker.assignedToId) {
      await resolveByDedupeKey(blocker.assignedToId, `blocker:${blocker.id}`, tx);
    }

    if (blocker.reportedById !== actor.id) {
      await notify(
        {
          userId: blocker.reportedById,
          kind: "blocker_resolved",
          title: "Your blocker was resolved",
          body: data.resolutionNote,
          projectId: blocker.projectId,
          taskId: blocker.taskId,
          blockerId: blocker.id,
        },
        tx,
      );
    }

    return blocker;
  });

  revalidatePath(`/projects/${result.projectId}`);
  revalidatePath("/");
  return result;
}
