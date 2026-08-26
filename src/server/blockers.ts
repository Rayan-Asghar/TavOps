"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blockers, projects, tasks, type blockerCategory } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { addBusinessHours } from "@/lib/business-time";
import { notify, resolveByDedupeKey } from "./notifications";
import {
  reportBlockerSchema,
  resolveBlockerSchema,
  type ReportBlockerInput,
  type ResolveBlockerInput,
} from "./schemas";

type Category = (typeof blockerCategory.enumValues)[number];

/** Categories the client owns. These stop the delivery clock. */
const CLIENT_SIDE: readonly Category[] = ["waiting_on_client"];

const URGENT_SLA_HOURS = 4;
const NORMAL_SLA_HOURS = 8;


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
    if (!project) throw new Error("Project not found.");

    if (data.taskId) {
      const [task] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, data.taskId), eq(tasks.projectId, data.projectId)))
        .limit(1);
      if (!task) throw new Error("Task does not belong to that project.");
    }

    const isClientSide = CLIENT_SIDE.includes(data.category);
    const assignedToId = isClientSide
      ? (project.salesOwnerId ?? project.pmId)
      : (project.deliveryLeadId ?? project.pmId);

    const slaHours = data.isUrgent ? URGENT_SLA_HOURS : NORMAL_SLA_HOURS;

    const [blocker] = await tx
      .insert(blockers)
      .values({
        projectId: data.projectId,
        taskId: data.taskId ?? null,
        reportedById: actor.id,
        assignedToId: assignedToId ?? null,
        category: data.category,
        ownerSide: isClientSide ? "client" : "internal",
        description: data.description,
        isUrgent: data.isUrgent,
        slaDueAt: addBusinessHours(new Date(), slaHours),
      })
      .returning();

    if (data.taskId) {
      await tx
        .update(tasks)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(tasks.id, data.taskId));
    }

    if (assignedToId && assignedToId !== actor.id) {
      await notify(
        {
          userId: assignedToId,
          kind: "blocker_opened",
          title: `${data.isUrgent ? "URGENT — " : ""}Blocked: ${project.name}`,
          body: data.description,
          projectId: data.projectId,
          taskId: data.taskId ?? null,
          blockerId: blocker.id,
          isActionable: true,
          dedupeKey: `blocker:${blocker.id}`,
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
    if (!blocker) throw new Error("Blocker not found.");

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
