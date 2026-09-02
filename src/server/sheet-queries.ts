import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projectMembers,
  sheetConnections,
  syncJobs,
  users,
} from "@/db/schema";

/**
 * Read side of the work-log sheet panel.
 *
 * Not a `"use server"` module — every export of one becomes a callable
 * endpoint, and these are queries.
 */

/** A sheet belongs to one person on one project; both identify it. */
export type SheetOwner = { projectId: string; userId: string };

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
    .where(
      and(
        eq(sheetConnections.projectId, owner.projectId),
        eq(sheetConnections.userId, owner.userId),
      ),
    )
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

export type MemberSheet = {
  userId: string;
  name: string;
  role: string;
  connectionId: string | null;
  spreadsheetUrl: string | null;
  status: "active" | "paused" | "error" | "archived" | null;
  queued: number;
  failed: number;
};

/**
 * Every person on a project, with the sheet they have been allotted.
 *
 * The project's own tab is where allotment happens, because the sheet is per
 * person per project and a project is where you can see both at once.
 */
export async function memberSheetsFor(
  projectId: string,
): Promise<MemberSheet[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      role: projectMembers.role,
      connectionId: sheetConnections.id,
      spreadsheetUrl: sheetConnections.spreadsheetUrl,
      status: sheetConnections.status,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .leftJoin(
      sheetConnections,
      and(
        eq(sheetConnections.projectId, projectMembers.projectId),
        eq(sheetConnections.userId, projectMembers.userId),
        ne(sheetConnections.status, "archived"),
      ),
    )
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.name));

  const ids = rows.map((r) => r.connectionId).filter(Boolean) as string[];
  const counts = ids.length
    ? await db
        .select({
          connectionId: syncJobs.connectionId,
          queued: sql<number>`count(*) filter (where ${eq(syncJobs.status, "queued")})::int`,
          failed: sql<number>`count(*) filter (where ${eq(syncJobs.status, "failed")})::int`,
        })
        .from(syncJobs)
        .where(inArray(syncJobs.connectionId, ids))
        .groupBy(syncJobs.connectionId)
    : [];
  const byConnection = new Map(counts.map((c) => [c.connectionId, c]));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    role: r.role,
    connectionId: r.connectionId,
    spreadsheetUrl: r.spreadsheetUrl,
    status: r.status,
    queued: r.connectionId ? (byConnection.get(r.connectionId)?.queued ?? 0) : 0,
    failed: r.connectionId ? (byConnection.get(r.connectionId)?.failed ?? 0) : 0,
  }));
}
