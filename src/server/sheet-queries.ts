import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sheetConnections, syncJobs } from "@/db/schema";

/**
 * Read side of the work-log sheet panel.
 *
 * Not a `"use server"` module — every export of one becomes a callable
 * endpoint, and these are queries.
 */

/** A sheet belongs to a project. */
export type SheetOwner = { projectId: string };

export type SheetStatus = {
  connection: {
    id: string;
    spreadsheetUrl: string;
    tabName: string;
    visibility: "internal" | "shareable";
    status: "active" | "paused" | "error" | "archived";
    errorMessage: string | null;
    lastSyncAt: Date | null;
  } | null;
  queued: number;
  failed: number;
  synced: number;
  lastError: string | null;
};

const EMPTY: SheetStatus = {
  connection: null,
  queued: 0,
  failed: 0,
  synced: 0,
  lastError: null,
};

export async function sheetStatusFor(
  owner: SheetOwner,
): Promise<SheetStatus> {
  const [connection] = await db
    .select()
    .from(sheetConnections)
    .where(eq(sheetConnections.projectId, owner.projectId))
    .limit(1);

  if (!connection || connection.status === "archived") return EMPTY;

  const [counts] = await db
    // Status values go through `eq()` rather than being written as literals
    // inside sql``. Literals are invisible to tsc: an enum rename broke exactly
    // this kind of query at runtime once while the build stayed green.
    .select({
      queued: sql<number>`count(*) filter (where ${eq(syncJobs.status, "queued")})::int`,
      failed: sql<number>`count(*) filter (where ${eq(syncJobs.status, "failed")})::int`,
      synced: sql<number>`count(*) filter (where ${eq(syncJobs.status, "done")})::int`,
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
      spreadsheetUrl: connection.spreadsheetUrl,
      tabName: connection.tabName,
      visibility: connection.visibility,
      status: connection.status,
      errorMessage: connection.errorMessage,
      lastSyncAt: connection.lastSyncAt,
    },
    queued: counts?.queued ?? 0,
    failed: counts?.failed ?? 0,
    synced: counts?.synced ?? 0,
    lastError: lastFailure?.lastError ?? null,
  };
}
