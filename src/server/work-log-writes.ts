import { and, eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import type { Db } from "@/db";
import { projects, tasks, workLogs, worklogRevisions } from "@/db/schema";
import { canAccessProject, type Actor } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import { isInvoiced } from "@/lib/billing-lock";
import { writeAudit } from "./audit";
import { enqueueSheetWrite } from "./sheet-sync";
import { recordWorkInTx } from "./record-work";
import {
  gridRowSchema,
  fieldFromPath,
  type GridRowInput,
  type RowOutcome,
} from "./grid-schemas";

/**
 * The correction half of the work-log write path, transaction-scoped.
 *
 * Not a `"use server"` module: every export of one becomes a callable endpoint,
 * and these are helpers. Same contract as `record-work.ts` — the caller owns the
 * transaction and has already authenticated; these functions authorize the row
 * and do the writing.
 *
 * Extracted so the single-entry actions and the grid's batch save share one
 * implementation of the revision chain, the billing lock, the ownership rule,
 * the outbox enqueue and the audit row. A second copy of any of those is a
 * second thing to keep correct.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type CorrectionTarget = Awaited<
  ReturnType<typeof loadForCorrectionInTx>
>;

/**
 * Loads an entry along with the facts the edit and delete rules need, and locks
 * it for the rest of the transaction.
 *
 * A log the actor cannot reach is reported as missing rather than forbidden,
 * matching the 404-not-403 rule the project pages follow: "that entry exists
 * but is not yours" is itself information about another project.
 *
 * `FOR UPDATE OF work_logs` does two jobs. It serialises the version the next
 * revision gets, which a batch would otherwise race on; and it closes the
 * check-then-act window on the invoiced and already-removed rules, which used
 * to be read on a different connection than the one that wrote. The `OF` clause
 * is load-bearing: without it the lock covers the joined `projects` row too, and
 * every concurrent edit anywhere on the project would serialise behind it.
 */
export async function loadForCorrectionInTx(
  tx: Tx,
  workLogId: string,
  actor: Actor,
  /**
   * Set by the batch path, which has already checked access once for the whole
   * grid. The project id is then asserted rather than re-queried, so a batch of
   * 200 rows does not run 400 access queries.
   */
  ctx?: { projectId: string },
) {
  const [row] = await tx
    .select({
      log: workLogs,
      invoicedThrough: projects.invoicedThrough,
    })
    .from(workLogs)
    .innerJoin(projects, eq(workLogs.projectId, projects.id))
    .where(eq(workLogs.id, workLogId))
    .limit(1)
    .for("update", { of: workLogs });

  const reachable = row
    ? ctx
      ? row.log.projectId === ctx.projectId
      : await canAccessProject(actor, row.log.projectId)
    : false;

  if (!row || !reachable) {
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

/**
 * Checked on both dates: moving an entry OUT of a billed period is as much a
 * rewrite of that invoice as changing its hours.
 */
export function assertEditable(
  oldDate: Date,
  newDate: Date,
  invoicedThrough: string | null,
): void {
  if (isInvoiced(oldDate, invoicedThrough) || isInvoiced(newDate, invoicedThrough)) {
    throw new UserFacingError(
      "That work has already been invoiced and can no longer be changed.",
    );
  }
}

/** Removal only has one date to check: where the entry already sits. */
export function assertRemovable(
  oldDate: Date,
  invoicedThrough: string | null,
): void {
  if (isInvoiced(oldDate, invoicedThrough)) {
    throw new UserFacingError(
      "That work has already been invoiced and can no longer be removed.",
    );
  }
}

/** The version this log's next revision gets. Callers must hold the row lock. */
export async function nextVersion(tx: Tx, workLogId: string): Promise<number> {
  const [{ max }] = await tx
    .select({
      max: sql<number>`coalesce(max(${worklogRevisions.version}), 0)::int`,
    })
    .from(worklogRevisions)
    .where(eq(worklogRevisions.workLogId, workLogId));
  return max + 1;
}

/**
 * A task must belong to the project being logged against, otherwise a crafted
 * taskId could attach hours to a project the actor cannot see. Same check as
 * `recordWorkInTx` makes on the create path.
 */
async function assertTaskOnProject(
  tx: Tx,
  taskId: string,
  projectId: string,
): Promise<void> {
  const [found] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!found) throw new UserFacingError("Task does not belong to that project.");
}

export type EditWorkLogInTxInput = {
  log: CorrectionTarget["log"];
  actor: Actor;
  hours: number;
  internalNotes: string;
  /** Only when the entry was filed against the wrong day. */
  workDate?: Date | null;
  /** `undefined` leaves the task alone; `null` detaches it. */
  taskId?: string | null;
  reason?: string | null;
  /** Recorded in the audit diff so a grid edit is distinguishable from a form
   *  correction without spending a permanent `change_source` enum value. */
  via?: "grid";
};

/**
 * Corrects an entry in place, appending a revision rather than overwriting.
 *
 * The mirrored columns on `work_logs` are what the app reads; the revision
 * chain is what says how they got that way. Both move together here, so the
 * head of the chain and the row always agree.
 */
export async function editWorkLogInTx(tx: Tx, input: EditWorkLogInTxInput) {
  const { log, actor } = input;
  const newDate = input.workDate ?? log.workDate;
  const taskId = input.taskId === undefined ? log.taskId : input.taskId;
  if (taskId && taskId !== log.taskId) {
    await assertTaskOnProject(tx, taskId, log.projectId);
  }

  const hours = input.hours.toFixed(2);
  const version = await nextVersion(tx, log.id);

  const [revision] = await tx
    .insert(worklogRevisions)
    .values({
      workLogId: log.id,
      version,
      taskId,
      workDate: newDate.toISOString().slice(0, 10),
      hours,
      statusAfter: log.resultingStatus,
      internalNotes: input.internalNotes,
      changedByUserId: actor.id,
      source: "ui",
      reason: input.reason ?? null,
    })
    .returning();

  await tx
    .update(workLogs)
    .set({
      hours,
      internalNotes: input.internalNotes,
      workDate: newDate,
      taskId,
      currentRevisionId: revision.id,
    })
    .where(eq(workLogs.id, log.id));

  // The sheet row is corrected in place, addressed by the entry's id.
  const queuedSync = await enqueueSheetWrite(tx, {
    projectId: log.projectId,
    workLogId: log.id,
    jobType: "update",
    changeKey: `revision:${revision.id}`,
  });

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
      internalNotes: input.internalNotes,
      workDate: newDate.toISOString().slice(0, 10),
      version,
      reason: input.reason ?? null,
      ...(input.via ? { via: input.via } : {}),
    },
  });

  return { revision, version, queuedSync };
}

export type DeleteWorkLogInTxInput = {
  log: CorrectionTarget["log"];
  actor: Actor;
  reason?: string | null;
  via?: "grid";
};

/**
 * Removes an entry without destroying it.
 *
 * A reversal revision (hours 0, `is_reversal`) is appended rather than the row
 * being deleted, so the total falls to what it should be while the record of
 * what was once claimed, and by whom, survives. Every hours query filters on
 * `deleted_at`.
 */
export async function deleteWorkLogInTx(
  tx: Tx,
  input: DeleteWorkLogInTxInput,
) {
  const { log, actor } = input;
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
    reason: input.reason ?? null,
  });

  await tx
    .update(workLogs)
    .set({ deletedAt: new Date() })
    .where(eq(workLogs.id, log.id));

  // The sheet keeps the row and blanks it: removing a row would shift every
  // row beneath it and invalidate every recorded position at once.
  const queuedDelete = await enqueueSheetWrite(tx, {
    projectId: log.projectId,
    workLogId: log.id,
    jobType: "delete",
    changeKey: `delete:${log.id}`,
  });

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
      reason: input.reason ?? null,
      ...(input.via ? { via: input.via } : {}),
    },
  });

  return { version, queuedDelete };
}

/* ------------------------------------------------------------------------- *
 * The grid's batch save
 * ------------------------------------------------------------------------- */

export type GridBatchContext = {
  actor: Actor;
  projectId: string;
  /** The grid's person filter, or null for a whole-project grid. */
  personId: string | null;
  /** `YYYY-MM`; every date in the batch must fall inside it. */
  month: string;
  /** Applies to every revision in the batch. Required for others' rows. */
  reason?: string | null;
  canEditOthers: boolean;
  invoicedThrough: string | null;
};

const MONTH_MISMATCH =
  "That day is outside the month you are editing — switch months first.";
const NEEDS_REASON = "Say why you are changing someone else's entry.";

/** UTC, like every other date in this system. */
function monthOfIso(iso: string): string {
  return iso.slice(0, 7);
}

function dateFromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Applies one grid save, inside the caller's transaction.
 *
 * Every row gets its own SAVEPOINT, so one rejection rolls back that row's
 * revision, audit row and sheet job and leaves the rest of the batch intact.
 * This is not a nicety: in Postgres any statement error aborts the whole
 * transaction, so "catch and continue" is *only* achievable with savepoints —
 * per-row transactions would be the alternative, and they would let a reader
 * see half a paste.
 *
 * Rows are sorted by work-log id before the loop so two concurrent batches over
 * overlapping rows take their locks in the same order and cannot deadlock.
 */
export async function applyGridRowsInTx(
  tx: Tx,
  ctx: GridBatchContext,
  rawRows: unknown[],
): Promise<RowOutcome[]> {
  const parsed: { raw: unknown; row?: GridRowInput; outcome?: RowOutcome }[] =
    rawRows.map((raw) => {
      const result = gridRowSchema.safeParse(raw);
      if (result.success) return { raw, row: result.data };

      // A pre-flight rejection costs no savepoint and no lock.
      const issue = result.error.issues[0];
      const key =
        raw && typeof raw === "object" && "rowKey" in raw
          ? String((raw as { rowKey: unknown }).rowKey)
          : "";
      return {
        raw,
        outcome: {
          rowKey: key,
          status: "rejected" as const,
          field: fieldFromPath(issue.path),
          error: issue.message,
        },
      };
    });

  const ordered = parsed
    .filter((p) => p.row)
    .sort((a, b) => {
      const ida = a.row && "workLogId" in a.row ? a.row.workLogId : "";
      const idb = b.row && "workLogId" in b.row ? b.row.workLogId : "";
      // Creates take no locks, so they go last and never sit in the ordering.
      return ida.localeCompare(idb);
    });

  const outcomes: RowOutcome[] = parsed
    .filter((p) => p.outcome)
    .map((p) => p.outcome as RowOutcome);

  for (const { row } of ordered) {
    if (!row) continue;
    try {
      outcomes.push(await applyOneRow(tx, ctx, row));
    } catch (err) {
      const rejection = asRejection(row, err);
      // An unexpected error is a batch failure, not a cell failure: rethrowing
      // is what stops a bug being reported to the user as "row 12 is invalid".
      if (!rejection) throw err;
      outcomes.push(rejection);
    }
  }

  return outcomes;
}

function asRejection(row: GridRowInput, err: unknown): RowOutcome | null {
  const known =
    err instanceof UserFacingError ||
    err instanceof ZodError ||
    (err instanceof Error && err.name === "ForbiddenError");
  if (!known) return null;

  return {
    rowKey: row.rowKey,
    status: "rejected",
    ...("workLogId" in row ? { workLogId: row.workLogId } : {}),
    field: err instanceof ZodError ? fieldFromPath(err.issues[0].path) : null,
    error:
      err instanceof ZodError
        ? err.issues[0].message
        : err instanceof Error
          ? err.message
          : "That change could not be saved.",
  };
}

async function applyOneRow(
  tx: Tx,
  ctx: GridBatchContext,
  row: GridRowInput,
): Promise<RowOutcome> {
  // Each row is its own savepoint; a throw inside rolls back only this row.
  return tx.transaction(async (sp) => {
    if (row.op === "create") return createRow(sp, ctx, row);

    const { log, invoicedThrough } = await loadForCorrectionInTx(
      sp,
      row.workLogId,
      ctx.actor,
      { projectId: ctx.projectId },
    );

    // A grid is one person's column when filtered; an update naming somebody
    // outside that scope is as much "not here" as one from another project.
    if (ctx.personId && log.userId !== ctx.personId) {
      throw new UserFacingError("That entry no longer exists.");
    }
    // Holding a stale view and saving over a colleague's correction is the
    // worst outcome available, and the token to prevent it already exists.
    if (
      row.expectedRevisionId !== null &&
      log.currentRevisionId !== row.expectedRevisionId
    ) {
      throw new UserFacingError(
        "Someone changed this entry while you had it open. Reload to see it.",
      );
    }
    if (log.userId !== ctx.actor.id && !ctx.reason) {
      throw new UserFacingError(NEEDS_REASON);
    }

    if (row.op === "remove") {
      assertRemovable(log.workDate, invoicedThrough);
      await deleteWorkLogInTx(sp, {
        log,
        actor: ctx.actor,
        reason: ctx.reason,
        via: "grid",
      });
      return { rowKey: row.rowKey, status: "removed", workLogId: log.id };
    }

    if (monthOfIso(row.workDate) !== ctx.month) {
      throw new UserFacingError(MONTH_MISMATCH);
    }
    const newDate = dateFromIso(row.workDate);
    assertEditable(log.workDate, newDate, invoicedThrough);

    // A row whose values already match writes no revision, no audit row and no
    // sheet job. Saving on blur means most cells arrive unchanged; a v2
    // identical to v1 is noise in the chain and a wasted write to Google.
    const taskId = row.taskId === undefined ? log.taskId : row.taskId;
    const unchanged =
      log.hours === row.hours.toFixed(2) &&
      log.internalNotes === row.internalNotes &&
      log.workDate.toISOString().slice(0, 10) === row.workDate &&
      (log.taskId ?? null) === (taskId ?? null);

    if (unchanged) {
      return { rowKey: row.rowKey, status: "unchanged", workLogId: log.id };
    }

    const result = await editWorkLogInTx(sp, {
      log,
      actor: ctx.actor,
      hours: row.hours,
      internalNotes: row.internalNotes,
      workDate: newDate,
      taskId: row.taskId,
      reason: ctx.reason,
      via: "grid",
    });

    return {
      rowKey: row.rowKey,
      status: "updated",
      workLogId: log.id,
      revisionId: result.revision.id,
      version: result.version,
    };
  });
}

async function createRow(
  tx: Tx,
  ctx: GridBatchContext,
  row: Extract<GridRowInput, { op: "create" }>,
): Promise<RowOutcome> {
  if (monthOfIso(row.workDate) !== ctx.month) {
    throw new UserFacingError(MONTH_MISMATCH);
  }

  const userId = row.userId ?? ctx.personId ?? ctx.actor.id;

  // `worklog.create` has always been a self-only grant — `logWork` hardcodes
  // the actor. Logging eight hours as somebody else is the same class of act as
  // changing their eight hours, so it takes the same capability.
  if (userId !== ctx.actor.id) {
    assertCan(ctx.actor.globalRole, "worklog.edit");
    if (!ctx.reason) throw new UserFacingError(NEEDS_REASON);
  }

  const workDate = dateFromIso(row.workDate);
  // A new entry inside a billed period restates a sent invoice just as an edit
  // to one does.
  assertEditable(workDate, workDate, ctx.invoicedThrough);

  const recorded = await recordWorkInTx(tx, {
    projectId: ctx.projectId,
    taskId: row.taskId ?? null,
    userId,
    actorId: ctx.actor.id,
    hours: row.hours,
    internalNotes: row.internalNotes,
    workDate,
  });

  return {
    rowKey: row.rowKey,
    status: "created",
    workLogId: recorded.entry.id,
    revisionId: recorded.revision.id,
    version: 1,
  };
}
