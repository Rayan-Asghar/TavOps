import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sheetConnections, syncJobs } from "@/db/schema";

/** Read side of sheet config. Not a "use server" module — see HANDOFF §4.13. */

export type SheetStatus = {
  connection: {
    id: string;
    spreadsheetId: string;
    tabName: string;
    mode: "ingest" | "append" | "update";
    headerRow: number;
    columnMap: Record<string, string>;
    clientOwnedColumns: string[];
    status: "active" | "paused" | "error" | "archived";
    errorMessage: string | null;
    lastSyncAt: Date | null;
    templateVersion: number;
  } | null;
  pending: number;
  held: number;
  failed: number;
  succeeded: number;
  lastError: string | null;
};

const EMPTY: SheetStatus = {
  connection: null,
  pending: 0,
  held: 0,
  failed: 0,
  succeeded: 0,
  lastError: null,
};

export async function sheetStatusFor(projectId: string): Promise<SheetStatus> {
  const [connection] = await db
    .select()
    .from(sheetConnections)
    .where(
      and(
        eq(sheetConnections.projectId, projectId),
        eq(sheetConnections.audience, "client"),
      ),
    )
    .limit(1);

  if (!connection) return EMPTY;

  const [counts] = await db
    // Status values go through `eq()` rather than being written as literals
    // inside sql``. Literals are invisible to tsc: the sync_status enum rename
    // broke exactly this query at runtime while the build stayed green.
    .select({
      pending: sql<number>`count(*) filter (where ${eq(syncJobs.status, "queued")})::int`,
      held: sql<number>`count(*) filter (where ${eq(syncJobs.status, "held")})::int`,
      failed: sql<number>`count(*) filter (where ${eq(syncJobs.status, "failed")})::int`,
      succeeded: sql<number>`count(*) filter (where ${eq(syncJobs.status, "done")})::int`,
    })
    .from(syncJobs)
    .where(eq(syncJobs.connectionId, connection.id));

  const [lastFailure] = await db
    .select({ lastError: syncJobs.lastError })
    .from(syncJobs)
    .where(
      and(
        eq(syncJobs.connectionId, connection.id),
        eq(syncJobs.status, "failed"),
      ),
    )
    .orderBy(desc(syncJobs.createdAt))
    .limit(1);

  return {
    connection: {
      id: connection.id,
      spreadsheetId: connection.spreadsheetId,
      tabName: connection.tabName,
      mode: connection.mode,
      headerRow: connection.headerRow,
      columnMap: connection.columnMap as Record<string, string>,
      clientOwnedColumns: connection.clientOwnedColumns,
      status: connection.status,
      errorMessage: connection.errorMessage,
      lastSyncAt: connection.lastSyncAt,
      templateVersion: connection.templateVersion,
    },
    pending: counts?.pending ?? 0,
    held: counts?.held ?? 0,
    failed: counts?.failed ?? 0,
    succeeded: counts?.succeeded ?? 0,
    lastError: lastFailure?.lastError ?? null,
  };
}
