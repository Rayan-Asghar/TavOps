"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan, can } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import {
  logWorkSchema,
  editWorkLogSchema,
  deleteWorkLogSchema,
  type LogWorkInput,
  type EditWorkLogInput,
  type DeleteWorkLogInput,
} from "./schemas";
import { recordWorkInTx } from "./record-work";
import {
  loadForCorrectionInTx,
  assertEditable,
  assertRemovable,
  editWorkLogInTx,
  deleteWorkLogInTx,
  applyGridRowsInTx,
} from "./work-log-writes";
import {
  saveGridEnvelopeSchema,
  summarise,
  type GridSaveState,
} from "./grid-schemas";
import { safeErrorMessage } from "./action-errors";
import { scheduleDrain } from "./sheet-sync";

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
  revalidatePath("/timesheet");
  return result;
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

  let projectId = "";
  let queuedSync = false;

  // The load sits inside the transaction so the row lock it takes covers the
  // invoiced check, the already-removed check and the version allocation. Read
  // on a separate connection, all three were check-then-act.
  await db.transaction(async (tx) => {
    const { log, invoicedThrough } = await loadForCorrectionInTx(
      tx,
      data.workLogId,
      actor,
    );
    projectId = log.projectId;
    assertEditable(log.workDate, data.workDate ?? log.workDate, invoicedThrough);

    const result = await editWorkLogInTx(tx, {
      log,
      actor,
      hours: data.hours,
      internalNotes: data.internalNotes,
      workDate: data.workDate ?? null,
      reason: data.reason,
    });
    queuedSync = result.queuedSync;
  });

  if (queuedSync) scheduleDrain();

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  revalidatePath("/timesheet");
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

  let projectId = "";
  let queuedDelete = false;

  await db.transaction(async (tx) => {
    const { log, invoicedThrough } = await loadForCorrectionInTx(
      tx,
      data.workLogId,
      actor,
    );
    projectId = log.projectId;
    assertRemovable(log.workDate, invoicedThrough);

    const result = await deleteWorkLogInTx(tx, {
      log,
      actor,
      reason: data.reason,
    });
    queuedDelete = result.queuedDelete;
  });

  if (queuedDelete) scheduleDrain();

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  revalidatePath("/timesheet");
  return { ok: true as const };
}

/**
 * One save from the grid: a batch of creates, corrections and removals.
 *
 * A single-cell commit is a batch of one and a paste is a batch of many, so
 * there is one write path rather than two — and because Server Actions dispatch
 * sequentially per client, twenty rows sent as twenty actions would be twenty
 * serial round trips.
 *
 * The six-step pattern holds, at batch granularity: authenticate, check the
 * capability, parse the envelope, check project access, one transaction, then
 * revalidate. Per-row validation happens inside, because a single
 * `schema.parse` produces a single message and one bad cell in row 17 would
 * reject 200 rows while naming none of them.
 */
export async function saveWorkLogGrid(input: unknown): Promise<GridSaveState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "worklog.create");

    const data = saveGridEnvelopeSchema.parse(input);
    await assertProjectAccess(actor, data.projectId);

    const [project] = await db
      .select({ invoicedThrough: projects.invoicedThrough })
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);
    if (!project) throw new UserFacingError("That project no longer exists.");

    const rows = await db.transaction((tx) =>
      applyGridRowsInTx(
        tx,
        {
          actor,
          projectId: data.projectId,
          personId: data.personId ?? null,
          month: data.month,
          reason: data.reason ?? null,
          canEditOthers: can(actor.globalRole, "worklog.edit"),
          invoicedThrough: project.invoicedThrough,
        },
        data.rows,
      ),
    );

    // Once per batch, never per row: the worker groups the queued jobs into one
    // Sheets call per month tab anyway.
    if (rows.some((r) => r.status !== "rejected" && r.status !== "unchanged")) {
      scheduleDrain();
      revalidatePath(`/projects/${data.projectId}`);
      revalidatePath("/");
      revalidatePath("/timesheet");
    }

    const rejected = rows.filter((r) => r.status === "rejected").length;
    return {
      ok: rejected === 0,
      message: summarise(rows),
      rows,
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "saveWorkLogGrid") };
  }
}
