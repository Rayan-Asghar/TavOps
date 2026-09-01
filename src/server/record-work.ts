import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  projects,
  tasks,
  workLogs,
  worklogRevisions,
  type taskStatus,
} from "@/db/schema";
import { UserFacingError } from "@/lib/errors";
import { notify, resolveByDedupeKey } from "./notifications";
import { writeAudit } from "./audit";
import { enqueueSheetWrite } from "./sheet-sync";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskStatus = (typeof taskStatus.enumValues)[number];

export type RecordWorkInput = {
  projectId: string;
  taskId?: string | null;
  userId: string;
  hours: number;
  internalNotes: string;
  resultingStatus?: TaskStatus | null;
  workDate?: Date;
};

/**
 * The single fan-out for "work happened".
 *
 * Both the manual log form and the timer's finish step call this, so the two
 * paths cannot drift — a change to notification behaviour applies to both by
 * construction. Caller owns the transaction and the authorization check; this
 * function assumes both have already happened.
 *
 * Everything here commits together or not at all: an entry cannot exist without
 * its revision, and the task status cannot move without the entry that moved it.
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
    if (!found)
      throw new UserFacingError("Task does not belong to that project.");
    task = found;
  }

  const [entry] = await tx
    .insert(workLogs)
    .values({
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      userId: input.userId,
      hours: input.hours.toFixed(2),
      internalNotes: input.internalNotes,
      resultingStatus: input.resultingStatus ?? null,
      source: "ui",
      ...(input.workDate ? { workDate: input.workDate } : {}),
    })
    .returning();

  // Version 1 of the revision chain. Written here rather than on first edit so
  // the chain is complete from the start — "what did this entry originally
  // say" has an answer for every log, not just edited ones.
  const [revision] = await tx
    .insert(worklogRevisions)
    .values({
      workLogId: entry.id,
      version: 1,
      taskId: entry.taskId,
      workDate: entry.workDate.toISOString().slice(0, 10),
      hours: entry.hours,
      statusAfter: input.resultingStatus ?? null,
      internalNotes: input.internalNotes,
      changedByUserId: input.userId,
      source: "ui",
    })
    .returning();

  await tx
    .update(workLogs)
    .set({ currentRevisionId: revision.id })
    .where(eq(workLogs.id, entry.id));

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
            body: `${project?.name ?? "Project"} — ${input.hours.toFixed(2)}h logged. ${input.internalNotes}`,
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

  await writeAudit(tx, {
    actorId: input.userId,
    projectId: input.projectId,
    entityType: "work_log",
    entityId: entry.id,
    action: "work_log.create",
    after: {
      hours: entry.hours,
      taskId: entry.taskId,
      workDate: entry.workDate.toISOString().slice(0, 10),
      resultingStatus: input.resultingStatus ?? null,
    },
  });

  // Queue the sheet write, never perform it: same transaction as the entry, so
  // the two cannot disagree about whether the work happened.
  const queuedSync = await enqueueSheetWrite(tx, {
    projectId: input.projectId,
    workLogId: entry.id,
    jobType: "append",
    idempotencyKey: `revision:${revision.id}`,
  });

  return { entry, revision, queuedSync };
}
