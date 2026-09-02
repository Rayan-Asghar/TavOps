"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { projects, workLogs, worklogRevisions } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import {
  assertProjectAccess,
  canAccessProject,
  type Actor,
} from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import { isInvoiced } from "@/lib/billing-lock";
import {
  logWorkSchema,
  editWorkLogSchema,
  deleteWorkLogSchema,
  type LogWorkInput,
  type EditWorkLogInput,
  type DeleteWorkLogInput,
} from "./schemas";
import { recordWorkInTx } from "./record-work";
import { writeAudit } from "./audit";
import { enqueueSheetWrite, scheduleDrain } from "./sheet-sync";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The wedge: one submission from a developer fans out to everything else.
 * The fan-out itself lives in recordWorkInTx so the timer's finish step takes
 * exactly the same path.
 */
export async function logWork(input: LogWorkInput) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "worklog.create");

  const data = logWorkSchema.parse(input);
  await assertProjectAccess(actor, data.projectId);

  const result = await db.transaction((tx) =>
    recordWorkInTx(tx, {
      projectId: data.projectId,
      taskId: data.taskId ?? null,
      userId: actor.id,
      hours: data.hours,
      internalNotes: data.internalNotes,
      resultingStatus: data.resultingStatus ?? null,
    }),
  );

  // The entry is committed; push it to the sheet once the response is out.
  if (result.queuedSync) scheduleDrain();

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/");
  return result;
}

/**
 * Loads an entry along with the facts the edit and delete rules need.
 *
 * A log the actor cannot reach is reported as missing rather than forbidden,
 * matching the 404-not-403 rule the project pages follow: "that entry exists
 * but is not yours" is itself information about another project.
 */
async function loadForCorrection(workLogId: string, actor: Actor) {
  const [row] = await db
    .select({
      log: workLogs,
      invoicedThrough: projects.invoicedThrough,
    })
    .from(workLogs)
    .innerJoin(projects, eq(workLogs.projectId, projects.id))
    .where(eq(workLogs.id, workLogId))
    .limit(1);

  if (!row || !(await canAccessProject(actor, row.log.projectId))) {
    throw new UserFacingError("That entry no longer exists.");
  }
  if (row.log.deletedAt) {
    throw new UserFacingError("That entry has already been removed.");
  }
  // Your own mistakes are yours to fix. Correcting somebody else's entry
  // changes what their day is recorded as having contained, so it is a
  // separate grant rather than a side effect of being able to read it.
  if (row.log.userId !== actor.id) {
    assertCan(actor.globalRole, "worklog.edit");
  }
  return row;
}

/** The version this log's next revision gets. */
async function nextVersion(tx: Tx, workLogId: string): Promise<number> {
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${worklogRevisions.version}), 0)::int` })
    .from(worklogRevisions)
    .where(eq(worklogRevisions.workLogId, workLogId));
  return max + 1;
}

/**
 * Corrects an entry in place, appending a revision rather than overwriting.
 *
 * The mirrored columns on `work_logs` are what the app reads; the revision
 * chain is what says how they got that way. Both move together here, so the
 * head of the chain and the row always agree.
 */
export async function editWorkLog(input: EditWorkLogInput) {
  const actor = await requireActor();
  const data = editWorkLogSchema.parse(input);
  const { log, invoicedThrough } = await loadForCorrection(data.workLogId, actor);

  const newDate = data.workDate ?? log.workDate;

  // Checked on both dates: moving an entry OUT of a billed period is as much a
  // rewrite of that invoice as changing its hours.
  if (isInvoiced(log.workDate, invoicedThrough) || isInvoiced(newDate, invoicedThrough)) {
    throw new UserFacingError(
      "That work has already been invoiced and can no longer be changed.",
    );
  }

  const hours = data.hours.toFixed(2);
  let queuedSync = false;

  await db.transaction(async (tx) => {
    const version = await nextVersion(tx, log.id);

    const [revision] = await tx
      .insert(worklogRevisions)
      .values({
        workLogId: log.id,
        version,
        taskId: log.taskId,
        workDate: newDate.toISOString().slice(0, 10),
        hours,
        statusAfter: log.resultingStatus,
        internalNotes: data.internalNotes,
        changedByUserId: actor.id,
        source: "ui",
        reason: data.reason,
      })
      .returning();

    await tx
      .update(workLogs)
      .set({
        hours,
        internalNotes: data.internalNotes,
        workDate: newDate,
        currentRevisionId: revision.id,
      })
      .where(eq(workLogs.id, log.id));

    // The sheet row is corrected in place, addressed by the entry's id.
    queuedSync =
      (await enqueueSheetWrite(tx, {
        projectId: log.projectId,
        userId: log.userId,
        workLogId: log.id,
        jobType: "update",
        changeKey: `revision:${revision.id}`,
      })) > 0;

    await writeAudit(tx, {
      actorId: actor.id,
      projectId: log.projectId,
      entityType: "work_log",
      entityId: log.id,
      action: "work_log.edit",
      before: {
        hours: log.hours,
        internalNotes: log.internalNotes,
        workDate: log.workDate.toISOString().slice(0, 10),
      },
      after: {
        hours,
        internalNotes: data.internalNotes,
        workDate: newDate.toISOString().slice(0, 10),
        version,
        reason: data.reason,
      },
    });
  });

  if (queuedSync) scheduleDrain();

  revalidatePath(`/projects/${log.projectId}`);
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Removes an entry without destroying it.
 *
 * A reversal revision (hours 0, `is_reversal`) is appended rather than the row
 * being deleted, so the total falls to what it should be while the record of
 * what was once claimed, and by whom, survives. Every hours query filters on
 * `deleted_at`.
 */
export async function deleteWorkLog(input: DeleteWorkLogInput) {
  const actor = await requireActor();
  const data = deleteWorkLogSchema.parse(input);
  const { log, invoicedThrough } = await loadForCorrection(data.workLogId, actor);

  if (isInvoiced(log.workDate, invoicedThrough)) {
    throw new UserFacingError(
      "That work has already been invoiced and can no longer be removed.",
    );
  }

  let queuedDelete = false;

  await db.transaction(async (tx) => {
    const version = await nextVersion(tx, log.id);

    await tx.insert(worklogRevisions).values({
      workLogId: log.id,
      version,
      taskId: log.taskId,
      workDate: log.workDate.toISOString().slice(0, 10),
      hours: "0.00",
      statusAfter: log.resultingStatus,
      internalNotes: log.internalNotes,
      isReversal: true,
      changedByUserId: actor.id,
      source: "ui",
      reason: data.reason,
    });

    await tx
      .update(workLogs)
      .set({ deletedAt: new Date() })
      .where(eq(workLogs.id, log.id));

    // The sheet keeps the row and blanks it: removing a row would shift every
    // row beneath it and invalidate every recorded position at once.
    queuedDelete =
      (await enqueueSheetWrite(tx, {
        projectId: log.projectId,
        userId: log.userId,
        workLogId: log.id,
        jobType: "delete",
        changeKey: `delete:${log.id}`,
      })) > 0;

    await writeAudit(tx, {
      actorId: actor.id,
      projectId: log.projectId,
      entityType: "work_log",
      entityId: log.id,
      action: "work_log.delete",
      // Keyed so the diff reads as a removal. Putting the hours under `before`
      // renders as "hours 23.00 -> —", which looks like the hours were cleared
      // rather than the entry withdrawn.
      before: { deleted: false },
      after: {
        deleted: true,
        hoursRemoved: log.hours,
        version,
        reason: data.reason,
      },
    });
  });

  if (queuedDelete) scheduleDrain();

  revalidatePath(`/projects/${log.projectId}`);
  revalidatePath("/");
  return { ok: true as const };
}
