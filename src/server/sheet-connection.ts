"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  sheetConnections,
  sheetRowLinks,
  syncJobs,
  workLogs,
} from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess, projectRoleOf } from "@/lib/access";
import { canInProject } from "@/lib/rbac";
import { ForbiddenError } from "@/lib/rbac";
import {
  TEMPLATE_VERSION,
  checkHeaders,
  parseSpreadsheetId,
  sheetUrl,
} from "@/lib/sheet-template";
import { hideIdColumn, readHeaderRow, readMeta } from "./sheets";
import { scheduleDrain } from "./sheet-sync";
import { safeErrorMessage } from "./action-errors";

import type { ActionState } from "@/lib/action-state";

/**
 * Attaching a project's work-log sheet.
 *
 * There is no "create it for us" path, and that is a constraint rather than an
 * omission: without Google Workspace there is no Shared Drive, so a sheet the
 * service account created would live in its own Drive with no human owner and
 * become unreachable the day those credentials rotate. The UI sends people to
 * Google's own `/copy` link instead, which puts the copy in *their* Drive, and
 * they paste it back here.
 */

/** Turns Google's errors into the thing the person needs to change. */
function explain(err: unknown): string {
  const e = err as { code?: number; status?: number; message?: string };
  const status = e?.code ?? e?.status;
  const msg = e?.message ?? String(err);

  if (msg.includes("not configured"))
    return "Google Sheets is not configured on the server. An admin needs to set the service account credentials.";
  if (msg.includes("invalid_grant"))
    return "The server's Google credentials are invalid. An admin needs to reissue the service account key.";
  if (msg.includes("Unable to parse range"))
    return "That tab does not exist in the sheet. Check the tab name.";
  // The single most common failure, and it is a two-second fix once named.
  if (status === 403)
    return "The sheet is not shared with Tavren yet. Share it with the address shown above as an Editor, then try again.";
  if (status === 404)
    return "No sheet found at that link. Check you copied the whole URL.";
  if (status === 429)
    return "Google is rate limiting us. Wait a minute and try again.";
  return msg;
}

/** Configuring a sheet belongs to whoever runs the project, not only to admins. */
async function assertCanConfigure(projectId: string) {
  const actor = await requireActor();
  await assertProjectAccess(actor, projectId);
  const projectRole = await projectRoleOf(actor, projectId);
  if (!canInProject(actor.globalRole, projectRole, "sheet.configure")) {
    throw new ForbiddenError("sheet.configure");
  }
  return actor;
}

/**
 * Connects a spreadsheet to a project.
 *
 * Validates the header row before storing anything. V1 requires the sheet to
 * already be the Tavren template — there is deliberately no column mapping, so
 * a sheet that does not match is refused with the column that is wrong rather
 * than being accommodated.
 */
export async function connectSheet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  try {
    await assertCanConfigure(projectId);

    const spreadsheetId = parseSpreadsheetId(String(formData.get("sheetUrl") ?? ""));
    if (!spreadsheetId) {
      return {
        error:
          "That does not look like a Google Sheets link. Copy the whole URL from the address bar.",
      };
    }

    const meta = await readMeta(spreadsheetId);
    const requestedTab = String(formData.get("tabName") ?? "").trim();
    const tab =
      meta.tabs.find((t) => t.title === requestedTab) ?? meta.tabs[0];
    if (!tab) return { error: "That spreadsheet has no tabs." };

    const headers = await readHeaderRow(spreadsheetId, tab.title);
    const check = checkHeaders(headers);
    if (!check.ok) {
      return {
        error: `That sheet is not the Tavren work-log template. ${check.reason}`,
      };
    }

    // Cosmetic, and never fatal: a visible id column still syncs correctly, so
    // a failure here must not stop the connection being made.
    try {
      await hideIdColumn(spreadsheetId, tab.sheetId);
    } catch {
      // ignored on purpose
    }

    const [existing] = await db
      .select()
      .from(sheetConnections)
      .where(eq(sheetConnections.projectId, projectId))
      .limit(1);

    const values = {
      projectId,
      spreadsheetId,
      spreadsheetUrl: sheetUrl(spreadsheetId),
      tabName: tab.title,
      visibility:
        String(formData.get("visibility") ?? "internal") === "shareable"
          ? ("shareable" as const)
          : ("internal" as const),
      templateVersion: TEMPLATE_VERSION,
      headerHash: check.hash,
      status: "active" as const,
      errorMessage: null,
      updatedAt: new Date(),
    };

    const connectionId = await db.transaction(async (tx) => {
      if (!existing) {
        const [row] = await tx.insert(sheetConnections).values(values).returning();
        return row.id;
      }

      await tx
        .update(sheetConnections)
        .set(values)
        .where(eq(sheetConnections.id, existing.id));

      // Pointing at a different spreadsheet invalidates every remembered row
      // position: they refer to rows in the sheet we just stopped using.
      if (
        existing.spreadsheetId !== spreadsheetId ||
        existing.tabName !== tab.title
      ) {
        await tx
          .delete(sheetRowLinks)
          .where(eq(sheetRowLinks.connectionId, existing.id));
      }
      return existing.id;
    });

    let backfilled = 0;
    if (formData.get("backfill") === "true") {
      backfilled = await queueBackfill(projectId, connectionId);
    }

    revalidatePath(`/projects/${projectId}`);
    if (backfilled > 0) scheduleDrain();

    return {
      ok: true,
      message: backfilled
        ? `Connected to "${meta.title}". Queued ${backfilled} existing ${backfilled === 1 ? "entry" : "entries"}.`
        : `Connected to "${meta.title}". New work logs will appear here.`,
    };
  } catch (err) {
    // Google's own errors are safe and actionable, so they bypass the generic
    // handler; anything else goes through it and is reduced to a reference.
    const message = explain(err);
    return {
      error:
        message === String((err as Error)?.message)
          ? safeErrorMessage(err, "connectSheet")
          : message,
    };
  }
}

/**
 * Queues every existing entry on the project.
 *
 * A sheet connected to a live project would otherwise start empty while the
 * team's hand-maintained one has months in it. The jobs are individual but the
 * worker groups them per connection, so a project with hundreds of entries
 * costs one API call per drained batch rather than one per entry.
 *
 * Keyed on the entry's current revision, the same key `recordWorkInTx` uses, so
 * reconnecting a sheet cannot append a second copy of anything already sent.
 */
async function queueBackfill(
  projectId: string,
  connectionId: string,
): Promise<number> {
  const entries = await db
    .select({ id: workLogs.id, revisionId: workLogs.currentRevisionId })
    .from(workLogs)
    .where(and(eq(workLogs.projectId, projectId), isNull(workLogs.deletedAt)))
    .orderBy(asc(workLogs.workDate));

  if (entries.length === 0) return 0;

  const rows = entries.map((e) => ({
    connectionId,
    workLogId: e.id,
    jobType: "append" as const,
    idempotencyKey: `revision:${e.revisionId ?? e.id}`,
  }));

  const inserted = await db
    .insert(syncJobs)
    .values(rows)
    .onConflictDoNothing({ target: syncJobs.idempotencyKey })
    .returning({ id: syncJobs.id });

  return inserted.length;
}

/** Pause or resume without losing the backlog. */
export async function toggleSheetSync(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "No project given." };
  try {
    await assertCanConfigure(projectId);

    const enabled = formData.get("enabled") === "true";
    await db
      .update(sheetConnections)
      .set({
        status: enabled ? "active" : "paused",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(sheetConnections.projectId, projectId));

    if (enabled) scheduleDrain();
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      message: enabled
        ? "Syncing resumed. Anything queued while it was paused goes across now."
        : "Syncing paused. Entries keep queueing and will go across when you resume.",
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "toggleSheetSync") };
  }
}

/** Puts failed jobs back in the queue, e.g. after fixing the sharing. */
export async function retryFailedSyncs(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "No project given." };
  try {
    await assertCanConfigure(projectId);

  const [connection] = await db
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(eq(sheetConnections.projectId, projectId))
    .limit(1);
  if (!connection) return { error: "No sheet is connected." };

  const requeued = await db.transaction(async (tx) => {
    const rows = await tx
      .update(syncJobs)
      .set({ status: "queued", attempts: 0, runAfter: new Date() })
      .where(
        and(
          eq(syncJobs.connectionId, connection.id),
          eq(syncJobs.status, "failed"),
        ),
      )
      .returning({ id: syncJobs.id });
    // Retrying implies the underlying problem was fixed, so the connection stops
    // advertising an error it no longer has.
    await tx
      .update(sheetConnections)
      .set({ status: "active", errorMessage: null, updatedAt: new Date() })
      .where(eq(sheetConnections.id, connection.id));
    return rows.length;
  });

  scheduleDrain();
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: `Retrying ${requeued} queued ${requeued === 1 ? "write" : "writes"}.` };
  } catch (err) {
    return { error: safeErrorMessage(err, "retryFailedSyncs") };
  }
}

export async function disconnectSheet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "No project given." };
  try {
    await assertCanConfigure(projectId);

  // Archived, not deleted: sync_jobs and sheet_row_links cascade off this row,
  // and destroying the record of what was already written loses the only
  // evidence of what the sheet was told.
  await db
    .update(sheetConnections)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(sheetConnections.projectId, projectId));

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: "Sheet disconnected. Nothing more will be written to it." };
  } catch (err) {
    return { error: safeErrorMessage(err, "disconnectSheet") };
  }
}
