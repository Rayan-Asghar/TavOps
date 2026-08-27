import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sheetMappings, syncJobs } from "@/db/schema";

/** Read side of sheet config. Not a "use server" module — see HANDOFF §4.13. */

export type SheetStatus = {
  mapping: {
    spreadsheetId: string;
    sheetName: string;
    mode: "append" | "update";
    headerRow: number;
    columnMap: Record<string, string>;
    isEnabled: boolean;
    lastSyncedAt: Date | null;
  } | null;
  pending: number;
  failed: number;
  succeeded: number;
  lastError: string | null;
};

export async function sheetStatusFor(projectId: string): Promise<SheetStatus> {
  const [mapping] = await db
    .select()
    .from(sheetMappings)
    .where(eq(sheetMappings.projectId, projectId))
    .limit(1);

  if (!mapping) {
    return { mapping: null, pending: 0, failed: 0, succeeded: 0, lastError: null };
  }

  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${syncJobs.status} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${syncJobs.status} = 'failed')::int`,
      succeeded: sql<number>`count(*) filter (where ${syncJobs.status} = 'success')::int`,
    })
    .from(syncJobs)
    .where(eq(syncJobs.mappingId, mapping.id));

  const [lastFailure] = await db
    .select({ lastError: syncJobs.lastError })
    .from(syncJobs)
    .where(and(eq(syncJobs.mappingId, mapping.id), eq(syncJobs.status, "failed")))
    .orderBy(desc(syncJobs.createdAt))
    .limit(1);

  return {
    mapping: {
      spreadsheetId: mapping.spreadsheetId,
      sheetName: mapping.sheetName,
      mode: mapping.mode as "append" | "update",
      headerRow: mapping.headerRow,
      columnMap: mapping.columnMap as Record<string, string>,
      isEnabled: mapping.isEnabled,
      lastSyncedAt: mapping.lastSyncedAt,
    },
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    succeeded: counts?.succeeded ?? 0,
    lastError: lastFailure?.lastError ?? null,
  };
}
