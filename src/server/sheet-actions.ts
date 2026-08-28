"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { sheetConnections, syncJobs } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { readHeaderRow, sheetsClient, a1Range } from "./sheets";
import {
  applyTemplateSchema,
  CLIENT_TEMPLATE_COLUMNS,
  inspectSheetSchema,
  parseSpreadsheetId,
  saveMappingSchema,
  templateColumnMap,
} from "./sheet-schemas";

/** The one client connection for a project. */
const clientConnection = (projectId: string) =>
  and(
    eq(sheetConnections.projectId, projectId),
    eq(sheetConnections.audience, "client"),
  );

export type SheetState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Populated by inspectSheet so the form can offer real tabs and headers. */
  inspection?: {
    spreadsheetId: string;
    title: string;
    tabs: string[];
    headers: { column: string; label: string }[];
    suggested: Record<string, string>;
  };
};

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
    return "That tab does not exist in the sheet. Pick one from the list.";
  if (status === 403)
    return "The sheet is not shared with Tavren yet. Share it with the address shown above as an Editor, then try again.";
  if (status === 404)
    return "No sheet found at that link. Check you copied the whole URL.";
  if (status === 429)
    return "Google is rate limiting us. Wait a minute and try again.";
  return msg;
}

/** Header text -> Tavren field. Loose on purpose: client sheets say "Hrs",
 *  "Time Spent" and "Hours" for the same column. */
const GUESSES: [RegExp, string][] = [
  [/date|day/i, "date"],
  [/task|item|deliverable|work item/i, "taskTitle"],
  [/dev|who|resource|assignee|name|by/i, "developer"],
  [/hour|hrs|time/i, "hours"],
  [/note|comment|detail|remark|description/i, "notes"],
  [/status|state|progress/i, "status"],
];

export async function inspectSheet(
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "sheet.configure");

    const data = inspectSheetSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      sheetUrl: String(formData.get("sheetUrl") ?? ""),
    });
    await assertProjectAccess(actor, data.projectId);

    const spreadsheetId = parseSpreadsheetId(data.sheetUrl);
    if (!spreadsheetId) {
      return {
        error:
          "That does not look like a Google Sheets link. Copy the whole URL from the address bar.",
      };
    }

    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean) as string[];

    if (tabs.length === 0) return { error: "That sheet has no tabs." };

    const headers = await readHeaderRow({
      spreadsheetId,
      sheetName: tabs[0],
      headerRow: 1,
    });

    const suggested: Record<string, string> = {};
    for (const h of headers) {
      for (const [re, field] of GUESSES) {
        if (!suggested[field] && re.test(h.label)) {
          suggested[field] = h.column;
          break;
        }
      }
    }
    // A blank append-only log still needs somewhere to put the values.
    if (Object.keys(suggested).length === 0) {
      Object.assign(suggested, {
        date: "A", taskTitle: "B", developer: "C",
        hours: "D", notes: "E", status: "F",
      });
    }

    return {
      ok: true,
      inspection: {
        spreadsheetId,
        title: meta.data.properties?.title ?? "Untitled",
        tabs,
        headers,
        suggested,
      },
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: err.issues[0]?.message ?? "Check the link." };
    }
    return { error: explain(err) };
  }
}

/** Re-reads headers when the person picks a different tab. */
export async function inspectTab(
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "sheet.configure");
    const projectId = String(formData.get("projectId") ?? "");
    const spreadsheetId = String(formData.get("spreadsheetId") ?? "");
    const sheetName = String(formData.get("sheetName") ?? "");
    await assertProjectAccess(actor, projectId);

    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean) as string[];
    const headers = await readHeaderRow({ spreadsheetId, sheetName, headerRow: 1 });

    const suggested: Record<string, string> = {};
    for (const h of headers) {
      for (const [re, field] of GUESSES) {
        if (!suggested[field] && re.test(h.label)) {
          suggested[field] = h.column;
          break;
        }
      }
    }
    if (Object.keys(suggested).length === 0) {
      Object.assign(suggested, {
        date: "A", taskTitle: "B", developer: "C",
        hours: "D", notes: "E", status: "F",
      });
    }

    return {
      ok: true,
      inspection: {
        spreadsheetId,
        title: meta.data.properties?.title ?? "Untitled",
        tabs,
        headers,
        suggested,
      },
    };
  } catch (err) {
    return { error: explain(err) };
  }
}

export async function saveSheetMapping(
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "sheet.configure");

    const columnMap: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith("col.")) continue;
      const value = String(v).trim().toUpperCase();
      if (value) columnMap[k.slice(4)] = value;
    }

    // "G, H" from the form becomes ["G","H"]; blank becomes [].
    const clientOwnedColumns = String(formData.get("clientOwnedColumns") ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    const data = saveMappingSchema.parse({
      clientOwnedColumns,
      projectId: String(formData.get("projectId") ?? ""),
      spreadsheetId: String(formData.get("spreadsheetId") ?? ""),
      sheetName: String(formData.get("sheetName") ?? ""),
      mode: String(formData.get("mode") ?? "append"),
      headerRow: formData.get("headerRow") || 1,
      columnMap,
    });
    await assertProjectAccess(actor, data.projectId);

    const [existing] = await db
      .select({ id: sheetConnections.id })
      .from(sheetConnections)
      .where(clientConnection(data.projectId))
      .limit(1);

    const values = {
      projectId: data.projectId,
      audience: "client" as const,
      spreadsheetId: data.spreadsheetId,
      tabName: data.sheetName,
      mode: data.mode,
      columnMap: data.columnMap,
      headerRow: data.headerRow,
      clientOwnedColumns: data.clientOwnedColumns,
      status: "active" as const,
      errorMessage: null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(sheetConnections)
        .set(values)
        .where(eq(sheetConnections.id, existing.id));
    } else {
      await db.insert(sheetConnections).values(values);
    }

    revalidatePath(`/projects/${data.projectId}`);
    return {
      ok: true,
      message:
        "Sheet connected. Work logs that carry a client update will sync to it.",
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: err.issues[0]?.message ?? "Check the mapping." };
    }
    return { error: explain(err) };
  }
}

/**
 * Writes a throwaway row and clears it again, proving the sheet is reachable
 * and writable before anyone relies on it.
 */
export async function testSheetConnection(
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "sheet.configure");
    const projectId = String(formData.get("projectId") ?? "");
    await assertProjectAccess(actor, projectId);

    const [connection] = await db
      .select()
      .from(sheetConnections)
      .where(clientConnection(projectId))
      .limit(1);
    if (!connection) return { error: "No sheet is connected yet." };

    const sheets = sheetsClient();
    const marker = `TavrenOPS test ${new Date().toISOString().slice(11, 19)}`;
    const cols = Object.values(connection.columnMap as Record<string, string>)
      .filter((c) => !connection.clientOwnedColumns.includes(c));
    const firstCol = cols.sort()[0] ?? "A";

    await sheets.spreadsheets.values.append({
      spreadsheetId: connection.spreadsheetId,
      range: a1Range(connection.tabName, `${firstCol}:${firstCol}`),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[marker]] },
    });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: connection.spreadsheetId,
      range: a1Range(connection.tabName, `${firstCol}:${firstCol}`),
    });
    const rows = res.data.values ?? [];
    const at = rows.findIndex((r) => (r ?? [])[0] === marker) + 1;
    if (at > 0) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: connection.spreadsheetId,
        range: a1Range(connection.tabName, `${firstCol}${at}`),
      });
    }

    return {
      ok: true,
      message: `Wrote and removed a test row. The sheet is reachable and writable.`,
    };
  } catch (err) {
    return { error: explain(err) };
  }
}

export async function toggleSheetSync(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "sheet.configure");
  const projectId = String(formData.get("projectId") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!projectId) return;
  await assertProjectAccess(actor, projectId);

  await db
    .update(sheetConnections)
    .set({ status: enabled ? "active" : "paused", updatedAt: new Date() })
    .where(clientConnection(projectId));
  revalidatePath(`/projects/${projectId}`);
}

/** Puts failed jobs back in the queue, e.g. after fixing sharing. */
export async function retryFailedSyncs(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "sheet.configure");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await assertProjectAccess(actor, projectId);

  const [connection] = await db
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(clientConnection(projectId))
    .limit(1);
  if (!connection) return;

  await db.transaction(async (tx) => {
    await tx
      .update(syncJobs)
      .set({ status: "queued", attempts: 0, runAfter: new Date() })
      .where(
        and(
          eq(syncJobs.connectionId, connection.id),
          eq(syncJobs.status, "failed"),
        ),
      );
    // Retrying implies the underlying problem was fixed, so the connection
    // stops advertising an error it no longer has.
    await tx
      .update(sheetConnections)
      .set({ status: "active", errorMessage: null, updatedAt: new Date() })
      .where(eq(sheetConnections.id, connection.id));
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function disconnectSheet(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "sheet.configure");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await assertProjectAccess(actor, projectId);

  // Archived, not deleted: sync_jobs and sheet_row_links cascade off this row,
  // and destroying the record of what was already sent to a client loses the
  // only evidence of what they were told.
  await db
    .update(sheetConnections)
    .set({ status: "archived", updatedAt: new Date() })
    .where(clientConnection(projectId));
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Sets a shared blank sheet up with the standard Tavren layout.
 *
 * Most client sheets are ours to design, so hand-mapping columns is a step that
 * usually does not need to exist. The head still creates the spreadsheet and
 * shares it — deliberately, because a sheet the service account creates itself
 * has no human owner, lives in a service account's Drive, and becomes
 * unreachable the day those credentials are rotated.
 *
 * Refuses to write over an existing header row: a sheet with data in it is
 * probably the client's own layout, which is what the manual flow is for.
 */
export async function applyClientTemplate(
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "sheet.configure");

    const data = applyTemplateSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      sheetUrl: String(formData.get("sheetUrl") ?? ""),
      sheetName: String(formData.get("sheetName") || "Sheet1"),
    });
    await assertProjectAccess(actor, data.projectId);

    const spreadsheetId = parseSpreadsheetId(data.sheetUrl);
    if (!spreadsheetId) {
      return {
        error:
          "That does not look like a Google Sheets link. Copy the whole URL from the address bar.",
      };
    }

    const sheets = sheetsClient();

    const existing = await readHeaderRow({
      spreadsheetId,
      sheetName: data.sheetName,
      headerRow: 1,
    });
    if (existing.some((h) => h.label.trim() !== "")) {
      return {
        error:
          "That tab already has a header row. Use “Map columns manually” so nothing of the client's is overwritten.",
      };
    }

    const headers = CLIENT_TEMPLATE_COLUMNS.map((c) => c.header);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1Range(data.sheetName, `A1:${String.fromCharCode(64 + headers.length)}1`),
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    const columnMap = templateColumnMap();

    const [current] = await db
      .select({ id: sheetConnections.id })
      .from(sheetConnections)
      .where(clientConnection(data.projectId))
      .limit(1);

    const values = {
      projectId: data.projectId,
      audience: "client" as const,
      spreadsheetId,
      tabName: data.sheetName,
      mode: "append" as const,
      columnMap,
      headerRow: 1,
      clientOwnedColumns: [],
      templateVersion: 1,
      status: "active" as const,
      errorMessage: null,
      updatedAt: new Date(),
    };

    if (current) {
      await db
        .update(sheetConnections)
        .set(values)
        .where(eq(sheetConnections.id, current.id));
    } else {
      await db.insert(sheetConnections).values(values);
    }

    revalidatePath(`/projects/${data.projectId}`);
    return {
      ok: true,
      message: `Template written and connected. ${headers.length} columns, ready for the client.`,
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: err.issues[0]?.message ?? "Check the link." };
    }
    return { error: explain(err) };
  }
}
