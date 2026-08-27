"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { sheetMappings, syncJobs } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { readHeaderRow, sheetsClient, a1Range } from "./sheets";
import {
  inspectSheetSchema,
  parseSpreadsheetId,
  saveMappingSchema,
} from "./sheet-schemas";

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

    const data = saveMappingSchema.parse({
      projectId: String(formData.get("projectId") ?? ""),
      spreadsheetId: String(formData.get("spreadsheetId") ?? ""),
      sheetName: String(formData.get("sheetName") ?? ""),
      mode: String(formData.get("mode") ?? "append"),
      headerRow: formData.get("headerRow") || 1,
      columnMap,
    });
    await assertProjectAccess(actor, data.projectId);

    await db
      .insert(sheetMappings)
      .values({ ...data, isEnabled: true })
      .onConflictDoUpdate({
        target: sheetMappings.projectId,
        set: { ...data, isEnabled: true },
      });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, message: "Sheet connected. New work logs will sync." };
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

    const [mapping] = await db
      .select()
      .from(sheetMappings)
      .where(eq(sheetMappings.projectId, projectId))
      .limit(1);
    if (!mapping) return { error: "No sheet is connected yet." };

    const sheets = sheetsClient();
    const marker = `TavrenOPS test ${new Date().toISOString().slice(11, 19)}`;
    const cols = Object.values(mapping.columnMap as Record<string, string>);
    const firstCol = cols.sort()[0] ?? "A";

    await sheets.spreadsheets.values.append({
      spreadsheetId: mapping.spreadsheetId,
      range: a1Range(mapping.sheetName, `${firstCol}:${firstCol}`),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[marker]] },
    });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: mapping.spreadsheetId,
      range: a1Range(mapping.sheetName, `${firstCol}:${firstCol}`),
    });
    const rows = res.data.values ?? [];
    const at = rows.findIndex((r) => (r ?? [])[0] === marker) + 1;
    if (at > 0) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: mapping.spreadsheetId,
        range: a1Range(mapping.sheetName, `${firstCol}${at}`),
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
    .update(sheetMappings)
    .set({ isEnabled: enabled })
    .where(eq(sheetMappings.projectId, projectId));
  revalidatePath(`/projects/${projectId}`);
}

/** Puts failed jobs back in the queue, e.g. after fixing sharing. */
export async function retryFailedSyncs(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "sheet.configure");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await assertProjectAccess(actor, projectId);

  const [mapping] = await db
    .select({ id: sheetMappings.id })
    .from(sheetMappings)
    .where(eq(sheetMappings.projectId, projectId))
    .limit(1);
  if (!mapping) return;

  await db
    .update(syncJobs)
    .set({ status: "queued", attempts: 0, nextAttemptAt: new Date() })
    .where(eq(syncJobs.mappingId, mapping.id));
  revalidatePath(`/projects/${projectId}`);
}

export async function disconnectSheet(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "sheet.configure");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await assertProjectAccess(actor, projectId);

  await db.delete(sheetMappings).where(eq(sheetMappings.projectId, projectId));
  revalidatePath(`/projects/${projectId}`);
}
