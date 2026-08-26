"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  projects,
  sheetMappings,
  syncJobs,
  tasks,
  workLogs,
  type taskStatus,
} from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { notify, resolveByDedupeKey } from "./notifications";
import { logWorkSchema, type LogWorkInput } from "./schemas";

type TaskStatus = (typeof taskStatus.enumValues)[number];


/**
 * The wedge: one submission from a developer fans out to everything else.
 *
 *   work_logs row  ->  task status + freshness clock
 *                  ->  reviewer notification
 *                  ->  queued Google Sheets row
 *                  ->  clears any "you owe an update" inbox line
 *
 * All of it commits in one transaction so a developer never ends up with hours
 * recorded but no sync queued, or vice versa. The Sheets call itself happens
 * out of band in the worker — the API call must never sit between the developer
 * and their submit button.
 */
export async function logWork(input: LogWorkInput) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "worklog.create");

  const data = logWorkSchema.parse(input);
  await assertProjectAccess(actor, data.projectId);

  const result = await db.transaction(async (tx) => {
    // A task must belong to the project being logged against, otherwise a
    // crafted taskId could attach hours to a project the actor cannot see.
    let task = null;
    if (data.taskId) {
      const [found] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, data.taskId), eq(tasks.projectId, data.projectId)))
        .limit(1);
      if (!found) throw new Error("Task does not belong to that project.");
      task = found;
    }

    const [entry] = await tx
      .insert(workLogs)
      .values({
        projectId: data.projectId,
        taskId: data.taskId ?? null,
        userId: actor.id,
        hours: data.hours.toFixed(2),
        notes: data.notes,
        resultingStatus: (data.resultingStatus as TaskStatus | null) ?? null,
      })
      .returning();

    if (task) {
      await tx
        .update(tasks)
        .set({
          status: (data.resultingStatus as TaskStatus | null) ?? task.status,
          lastUpdateAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      // The developer has just reported, so any outstanding nag is stale.
      await resolveByDedupeKey(actor.id, `update_missing:${task.id}`, tx);

      if (data.resultingStatus === "in_review") {
        const [project] = await tx
          .select({
            deliveryLeadId: projects.deliveryLeadId,
            pmId: projects.pmId,
            name: projects.name,
          })
          .from(projects)
          .where(eq(projects.id, data.projectId))
          .limit(1);

        const reviewer = project?.deliveryLeadId ?? project?.pmId;
        if (reviewer && reviewer !== actor.id) {
          await notify(
            {
              userId: reviewer,
              kind: "task_needs_review",
              title: `Ready for review: ${task.title}`,
              body: `${project?.name ?? "Project"} — ${data.hours}h logged. ${data.notes}`,
              projectId: data.projectId,
              taskId: task.id,
              isActionable: true,
              dedupeKey: `review:${task.id}`,
            },
            tx,
          );
        }
      }
    }

    // Queue the sheet write. Enqueue only — never call Google here.
    const [mapping] = await tx
      .select()
      .from(sheetMappings)
      .where(
        and(
          eq(sheetMappings.projectId, data.projectId),
          eq(sheetMappings.isEnabled, true),
        ),
      )
      .limit(1);

    if (mapping) {
      await tx.insert(syncJobs).values({
        mappingId: mapping.id,
        workLogId: entry.id,
        payload: {
          taskTitle: task?.title ?? "(general project work)",
          taskId: task?.id ?? null,
          sheetRowRef: task?.sheetRowRef ?? null,
          hours: data.hours,
          notes: data.notes,
          status: data.resultingStatus ?? task?.status ?? null,
          workedBy: actor.id,
          workDate: entry.workDate.toISOString(),
        },
      });
    }

    return { entry, queuedSync: !!mapping };
  });

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/");
  return result;
}
