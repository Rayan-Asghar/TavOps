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
import { canInProject, ForbiddenError } from "@/lib/rbac";
import {
  HEADER_ROW,
  TEMPLATE_VERSION,
  checkHeaders,
  parseSpreadsheetId,
  sheetUrl,
} from "@/lib/sheet-template";
import {
  hideIdColumn,
  readHeaderRow,
  readMeta,
  readOtherEditors,
  writeIdHeading,
} from "./sheets";
import { scheduleDrain } from "./sheet-sync";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";

/**
 * Allotting a work-log sheet.
 *
 * A sheet belongs to one person on one project. Two developers on a project keep
 * two sheets; one developer on two projects keeps two sheets. That is how the
 * team's own trackers are organised — a file per person per engagement, a tab
 * per month, the project named in the column heading.
 *
 * There is no "create it for us" path, and that is a constraint rather than an
 * omission: without Google Workspace there is no Shared Drive, so a sheet the
 * service account created would live in its own Drive with no human owner and
 * become unreachable the day those credentials rotate. The UI sends people to
 * Google's own `/copy` link instead, which puts the copy in *their* Drive.
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
  // The single most common failure, and a two-second fix once named.
  if (status === 403)
    return "The sheet is not shared with Tavren yet. Share it with the address shown above as an Editor, then try again.";
  if (status === 404)
    return "No sheet found at that link. Check you copied the whole URL.";
  if (status === 429)
    return "Google is rate limiting us. Wait a minute and try again.";
  return msg;
}

/**
 * Allotted by whoever runs the project, or by a head or admin.
 *
 * Never by the developer whose sheet it is: that is what "allotted" means, and
 * it is why a developer cannot reach this tab at all.
 */
async function assertCanConfigure(owner: { projectId: string }) {
  const actor = await requireActor();
  await assertProjectAccess(actor, owner.projectId);
  const projectRole = await projectRoleOf(actor, owner.projectId);
  if (!canInProject(actor.globalRole, projectRole, "sheet.configure")) {
    throw new ForbiddenError("sheet.configure");
  }
  return actor;
}

function revalidateFor(owner: { projectId: string }) {
  revalidatePath(`/projects/${owner.projectId}`);
  revalidatePath("/admin/sheets");
}

/**
 * Attaches a spreadsheet to a project or to a person.
 *
 * Validates the header row before storing anything. The sheet must already be
 * the Tavren template — there is deliberately no column mapping, so a sheet
 * that does not match is refused with the column that is wrong rather than
 * being accommodated.
 */
export async function connectSheet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  try {
    if (!projectId) return { error: "No project given." };
    if (!userId) return { error: "No person given." };
    const owner = { projectId, userId };
    await assertCanConfigure(owner);

    const spreadsheetId = parseSpreadsheetId(
      String(formData.get("sheetUrl") ?? ""),
    );
    if (!spreadsheetId) {
      return {
        error:
          "That does not look like a Google Sheets link. Copy the whole URL from the address bar.",
      };
    }

    const meta = await readMeta(spreadsheetId);
    const requestedTab = String(formData.get("tabName") ?? "").trim();
    const tab = meta.tabs.find((t) => t.title === requestedTab) ?? meta.tabs[0];
    if (!tab) return { error: "That spreadsheet has no tabs." };

    const headers = await readHeaderRow(spreadsheetId, tab.title);
    const check = checkHeaders(headers);
    if (!check.ok) {
      return {
        error: `That sheet is not the Tavren work-log layout. ${check.reason} The header row is row ${HEADER_ROW}, under the title and totals.`,
      };
    }

    // A sheet the team kept before Tavren existed has every column but the id.
    // Writing the heading in is what lets it be adopted rather than refused
    // over a column they never knew to add.
    if (check.needsIdColumn) {
      await writeIdHeading(spreadsheetId, tab.title);
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
      .where(
        and(
          eq(sheetConnections.projectId, projectId),
          eq(sheetConnections.userId, userId),
        ),
      )
      .limit(1);

    const values = {
      projectId,
      userId,
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
        const [row] = await tx
          .insert(sheetConnections)
          .values(values)
          .returning();
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
      backfilled = await queueBackfill(owner, connectionId);
    }

    revalidateFor(owner);
    if (backfilled > 0) scheduleDrain();

    // Whoever used to keep this sheet by hand still has Editor on it, and that
    // has turned from useful into a hazard — reported here rather than left to
    // be discovered when a sync breaks.
    const editors = await otherEditorsOrNone(spreadsheetId);

    const connected = backfilled
      ? `Connected to "${meta.title}". Queued ${backfilled} existing ${backfilled === 1 ? "entry" : "entries"}.`
      : `Connected to "${meta.title}". New work logs will appear here.`;

    return {
      ok: true,
      message: editors.length
        ? `${connected} Note that ${editors.join(", ")} can still edit this sheet directly — set them to Viewer in Google, or their edits will be overwritten.`
        : connected,
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
 * Never fatal.
 *
 * The sharing list is advice. A service-account key issued before the Drive
 * scope was added cannot read it, and refusing to connect a perfectly working
 * sheet over a missing warning would be the wrong trade.
 */
async function otherEditorsOrNone(spreadsheetId: string): Promise<string[]> {
  try {
    return await readOtherEditors(spreadsheetId);
  } catch {
    return [];
  }
}

/**
 * Queues the entries that already exist.
 *
 * A sheet allotted to somebody who has been working on the project for months
 * would otherwise start empty while the hand-kept one it replaces is full. The jobs are individual but the worker groups them per connection, so
 * hundreds of entries cost one API call per drained batch rather than one each.
 *
 * Keyed on the entry's current revision plus this connection, exactly as a live
 * append is, so reconnecting a sheet cannot append a second copy of anything
 * already sent to it.
 */
async function queueBackfill(
  owner: { projectId: string; userId: string },
  connectionId: string,
): Promise<number> {
  const entries = await db
    .select({ id: workLogs.id, revisionId: workLogs.currentRevisionId })
    .from(workLogs)
    .where(
      and(
        isNull(workLogs.deletedAt),
        eq(workLogs.projectId, owner.projectId),
        eq(workLogs.userId, owner.userId),
      ),
    )
    .orderBy(asc(workLogs.workDate));

  if (entries.length === 0) return 0;

  const inserted = await db
    .insert(syncJobs)
    .values(
      entries.map((e) => ({
        connectionId,
        workLogId: e.id,
        jobType: "append" as const,
        idempotencyKey: `revision:${e.revisionId ?? e.id}:${connectionId}`,
      })),
    )
    .onConflictDoNothing({ target: syncJobs.idempotencyKey })
    .returning({ id: syncJobs.id });

  return inserted.length;
}

/** Loads a connection and checks the caller may configure it. */
async function loadConfigurable(connectionId: string) {
  const [connection] = await db
    .select()
    .from(sheetConnections)
    .where(eq(sheetConnections.id, connectionId))
    .limit(1);
  if (!connection) return null;
  await assertCanConfigure(connection);
  return connection;
}

/** Pause or resume without losing the backlog. */
export async function toggleSheetSync(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const connection = await loadConfigurable(
      String(formData.get("connectionId") ?? ""),
    );
    if (!connection) return { error: "That sheet is no longer connected." };

    const enabled = formData.get("enabled") === "true";
    await db
      .update(sheetConnections)
      .set({
        status: enabled ? "active" : "paused",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(sheetConnections.id, connection.id));

    if (enabled) scheduleDrain();
    revalidateFor(connection);
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

/** Puts failed writes back in the queue, e.g. after fixing the sharing. */
export async function retryFailedSyncs(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const connection = await loadConfigurable(
      String(formData.get("connectionId") ?? ""),
    );
    if (!connection) return { error: "That sheet is no longer connected." };

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
      // Retrying implies the underlying problem was fixed, so the connection
      // stops advertising an error it no longer has.
      await tx
        .update(sheetConnections)
        .set({ status: "active", errorMessage: null, updatedAt: new Date() })
        .where(eq(sheetConnections.id, connection.id));
      return rows.length;
    });

    scheduleDrain();
    revalidateFor(connection);
    return {
      ok: true,
      message: `Retrying ${requeued} queued ${requeued === 1 ? "write" : "writes"}.`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "retryFailedSyncs") };
  }
}

export async function disconnectSheet(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const connection = await loadConfigurable(
      String(formData.get("connectionId") ?? ""),
    );
    if (!connection) return { error: "That sheet is no longer connected." };

    // Archived, not deleted: sync_jobs and sheet_row_links cascade off this
    // row, and destroying the record of what was already written loses the only
    // evidence of what the sheet was told.
    await db
      .update(sheetConnections)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sheetConnections.id, connection.id));

    revalidateFor(connection);
    return {
      ok: true,
      message: "Sheet disconnected. Nothing more will be written to it.",
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "disconnectSheet") };
  }
}
