import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  projects,
  sheetMappings,
  syncJobs,
  tasks,
  workLogs,
  type taskStatus,
} from "@/db/schema";
import { notify, resolveByDedupeKey } from "./notifications";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskStatus = (typeof taskStatus.enumValues)[number];

export type RecordWorkInput = {
  projectId: string;
  taskId?: string | null;
  userId: string;
  hours: number;
  notes: string;
  resultingStatus?: TaskStatus | null;
  workDate?: Date;
};

/**
 * The single fan-out for "work happened".
 *
 * Both the manual log form and the timer's finish step call this, so the two
 * paths cannot drift — a change to notification or sync behaviour applies to
 * both by construction. Caller owns the transaction and the authorization
 * check; this function assumes both have already happened.
 */
export async function recordWorkInTx(tx: Tx, input: RecordWorkInput) {
  // A task must belong to the project being logged against, otherwise a
  // crafted taskId could attach hours to a project the actor cannot see.
  let task = null;
  if (input.taskId) {
    const [found] = await tx
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId)),
      )
      .limit(1);
    if (!found) throw new Error("Task does not belong to that project.");
    task = found;
  }

  const [entry] = await tx
    .insert(workLogs)
    .values({
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      userId: input.userId,
      hours: input.hours.toFixed(2),
      notes: input.notes,
      resultingStatus: input.resultingStatus ?? null,
      ...(input.workDate ? { workDate: input.workDate } : {}),
    })
    .returning();

  if (task) {
    await tx
      .update(tasks)
      .set({
        status: input.resultingStatus ?? task.status,
        lastUpdateAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    // The developer has just reported, so any outstanding nag is stale.
    await resolveByDedupeKey(input.userId, `update_missing:${task.id}`, tx);

    if (input.resultingStatus === "in_review") {
      const [project] = await tx
        .select({
          deliveryLeadId: projects.deliveryLeadId,
          pmId: projects.pmId,
          name: projects.name,
        })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      const reviewer = project?.deliveryLeadId ?? project?.pmId;
      if (reviewer && reviewer !== input.userId) {
        await notify(
          {
            userId: reviewer,
            kind: "task_needs_review",
            title: `Ready for review: ${task.title}`,
            body: `${project?.name ?? "Project"} — ${input.hours.toFixed(2)}h logged. ${input.notes}`,
            projectId: input.projectId,
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
        eq(sheetMappings.projectId, input.projectId),
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
        hours: input.hours,
        notes: input.notes,
        status: input.resultingStatus ?? task?.status ?? null,
        workedBy: input.userId,
        workDate: entry.workDate.toISOString(),
      },
    });
  }

  return { entry, queuedSync: !!mapping };
}
