import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  projects,
  sheetConnections,
  syncJobs,
  tasks,
  workLogs,
  worklogRevisions,
  type taskStatus,
} from "@/db/schema";
import { UserFacingError } from "@/lib/errors";
import { notify, resolveByDedupeKey } from "./notifications";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskStatus = (typeof taskStatus.enumValues)[number];

export type RecordWorkInput = {
  projectId: string;
  taskId?: string | null;
  userId: string;
  hours: number;
  /** Never leaves Tavren. */
  internalNotes: string;
  /**
   * The one line the client may see. Optional on purpose: most entries have
   * nothing worth telling a client, and an empty value means no row is written
   * to their sheet at all rather than a row full of internal detail.
   */
  clientUpdate?: string | null;
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
 *
 * Everything here is one transaction with the sync job insert (the outbox
 * pattern): a work log can never be recorded without its sheet write being
 * queued, and a sheet write can never be queued for work that was not recorded.
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

  const clientUpdate = input.clientUpdate?.trim() || null;

  const [entry] = await tx
    .insert(workLogs)
    .values({
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      userId: input.userId,
      hours: input.hours.toFixed(2),
      internalNotes: input.internalNotes,
      clientUpdate,
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
      clientUpdate,
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
            // The reviewer is internal, so the internal note is the useful one.
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

  // Queue the sheet write. Enqueue only — never call Google here.
  //
  // No client update means nothing to tell the client, so no row is queued.
  // The alternative — writing the internal note, which is what this code used
  // to do — put private commentary into a shared client spreadsheet.
  let queuedSync = false;
  if (clientUpdate) {
    const [connection] = await tx
      .select({ id: sheetConnections.id, mode: sheetConnections.mode })
      .from(sheetConnections)
      .where(
        and(
          eq(sheetConnections.projectId, input.projectId),
          eq(sheetConnections.audience, "client"),
          eq(sheetConnections.status, "active"),
        ),
      )
      .limit(1);

    if (connection) {
      await tx.insert(syncJobs).values({
        connectionId: connection.id,
        jobType: "append",
        workLogId: entry.id,
        revisionId: revision.id,
        // Deterministic: the same revision can only ever produce one row, so a
        // retry after a timeout collides with the unique index and is a no-op
        // instead of writing the client a duplicate.
        idempotencyKey: `revision:${revision.id}`,
        payload: {
          taskTitle: task?.title ?? "(general project work)",
          taskId: task?.id ?? null,
          hours: input.hours,
          clientUpdate,
          status: input.resultingStatus ?? task?.status ?? null,
          workedBy: input.userId,
          workDate: entry.workDate.toISOString(),
        },
      });
      queuedSync = true;
    }
  }

  return { entry, revision, queuedSync };
}
