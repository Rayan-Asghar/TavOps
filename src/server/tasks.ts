"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { projects, reviews, tasks } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { notify, resolveByDedupeKey } from "./notifications";
import { createTaskSchema, reviewSchema, updateTaskSchema } from "./task-schemas";
import { safeErrorMessage } from "./action-errors";

export type TaskState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function toState(err: unknown): TaskState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of err.issues) {
      const k = String(i.path[0] ?? "_");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  return { error: safeErrorMessage(err, "task") };
}

export async function createTask(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "task.create");

    const data = createTaskSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
      assigneeId: formData.get("assigneeId") ?? "",
      estimatedHours: formData.get("estimatedHours") || undefined,
      dueDate: formData.get("dueDate") ?? "",
      priority: formData.get("priority") || 3,
    });

    await assertProjectAccess(actor, data.projectId);

    await db.transaction(async (tx) => {
      // Append to the end of the list rather than colliding on 0.
      const [{ maxOrder }] = await tx
        .select({
          maxOrder: sql<number>`coalesce(max(${tasks.orderIndex}), 0)::int`,
        })
        .from(tasks)
        .where(eq(tasks.projectId, data.projectId));

      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: data.projectId,
          title: data.title,
          description: data.description,
          assigneeId: data.assigneeId ?? null,
          estimatedHours: data.estimatedHours?.toFixed(2),
          dueDate: data.dueDate,
          priority: data.priority,
          orderIndex: maxOrder + 1,
        })
        .returning();

      if (data.assigneeId && data.assigneeId !== actor.id) {
        const [project] = await tx
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, data.projectId))
          .limit(1);
        await notify(
          {
            userId: data.assigneeId,
            kind: "task_assigned",
            title: `Assigned: ${task.title}`,
            body: `${project?.name ?? "Project"}${data.dueDate ? ` — due ${data.dueDate.toISOString().slice(0, 10)}` : ""}`,
            projectId: data.projectId,
            taskId: task.id,
            isActionable: true,
            dedupeKey: `assigned:${task.id}`,
          },
          tx,
        );
      }
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, message: "Task created." };
  } catch (err) {
    return toState(err);
  }
}

export async function updateTask(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "task.edit");

    const data = updateTaskSchema.parse({
      taskId: String(formData.get("taskId") ?? ""),
      title: formData.get("title") || undefined,
      assigneeId: formData.get("assigneeId") ?? "",
      estimatedHours: formData.get("estimatedHours") || undefined,
      dueDate: formData.get("dueDate") ?? "",
      priority: formData.get("priority") || undefined,
      status: formData.get("status") || undefined,
    });

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, data.taskId))
      .limit(1);
    if (!task) return { error: "Task not found." };
    await assertProjectAccess(actor, task.projectId);

    // Reassignment is the only change that needs telling somebody about.
    const reassigned =
      data.assigneeId !== undefined && data.assigneeId !== task.assigneeId;

    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          title: data.title ?? task.title,
          assigneeId: data.assigneeId ?? null,
          estimatedHours:
            data.estimatedHours?.toFixed(2) ?? task.estimatedHours,
          dueDate: data.dueDate ?? task.dueDate,
          priority: data.priority ?? task.priority,
          status: data.status ?? task.status,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      if (reassigned && data.assigneeId && data.assigneeId !== actor.id) {
        await notify(
          {
            userId: data.assigneeId,
            kind: "task_assigned",
            title: `Assigned: ${data.title ?? task.title}`,
            body: "Reassigned to you.",
            projectId: task.projectId,
            taskId: task.id,
            isActionable: true,
            dedupeKey: `assigned:${task.id}`,
          },
          tx,
        );
      }
    });

    revalidatePath(`/projects/${task.projectId}`);
    return { ok: true, message: "Task updated." };
  } catch (err) {
    return toState(err);
  }
}

/**
 * A QA decision. Approving finishes the task; requesting a revision sends it
 * back to the person who submitted it with a reason attached.
 *
 * Each decision is its own row, so "approved on the third round" stays visible
 * — that is the number worth knowing, and a status flag alone loses it.
 */
export async function submitReview(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "review.approve");

    const data = reviewSchema.parse({
      taskId: String(formData.get("taskId") ?? ""),
      decision: String(formData.get("decision") ?? ""),
      comments: String(formData.get("comments") ?? "") || undefined,
    });

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, data.taskId))
      .limit(1);
    if (!task) return { error: "Task not found." };
    if (task.status !== "in_review") {
      return { error: "That task is not waiting for review." };
    }
    await assertProjectAccess(actor, task.projectId);

    await db.transaction(async (tx) => {
      const [{ rounds }] = await tx
        .select({ rounds: sql<number>`count(*)::int` })
        .from(reviews)
        .where(eq(reviews.taskId, task.id));

      await tx.insert(reviews).values({
        taskId: task.id,
        projectId: task.projectId,
        reviewerId: actor.id,
        submittedById: task.assigneeId,
        decision: data.decision,
        comments: data.comments,
        round: rounds + 1,
      });

      await tx
        .update(tasks)
        .set({
          status: data.decision === "approved" ? "done" : "in_progress",
          lastUpdateAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      // The reviewer has acted, so the queue item is no longer outstanding.
      await resolveByDedupeKey(actor.id, `review:${task.id}`, tx);

      if (task.assigneeId && task.assigneeId !== actor.id) {
        await notify(
          {
            userId: task.assigneeId,
            kind:
              data.decision === "approved"
                ? "review_approved"
                : "revision_requested",
            title:
              data.decision === "approved"
                ? `Approved: ${task.title}`
                : `Revision needed: ${task.title}`,
            body:
              data.comments ??
              (data.decision === "approved" ? "Passed review." : ""),
            projectId: task.projectId,
            taskId: task.id,
            isActionable: data.decision !== "approved",
            dedupeKey:
              data.decision === "approved"
                ? `approved:${task.id}:${rounds + 1}`
                : `revision:${task.id}:${rounds + 1}`,
          },
          tx,
        );
      }
    });

    revalidatePath(`/projects/${task.projectId}`);
    revalidatePath("/review");
    revalidatePath("/");
    return {
      ok: true,
      message:
        data.decision === "approved" ? "Approved." : "Sent back for revision.",
    };
  } catch (err) {
    return toState(err);
  }
}
