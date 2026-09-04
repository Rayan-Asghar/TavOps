import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, workLogs } from "@/db/schema";
import type { Scope } from "./reports";

/**
 * The clients directory.
 *
 * `clients` has existed since the first migration with no screen of its own, so
 * a client was only ever visible as a name on a project row. Every tool this
 * app was measured against ships this at the free tier.
 *
 * Scoped like everything else: a client is visible when at least one of its
 * projects is. That means a developer sees the clients they actually work for
 * rather than the agency's whole book, without needing a separate capability.
 */

export type ClientRow = {
  id: string;
  name: string;
  industry: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  activeProjects: number;
  totalProjects: number;
  loggedHours: string;
  /**
   * ISO date, not a Date. A raw `sql<...>` annotation is a CLAIM about what the
   * driver returns, never a conversion — drizzle only parses columns it maps
   * itself, so `max(work_date)` arrives as a string and calling a Date method
   * on it throws at render time.
   */
  lastActivityAt: string | null;
};

export async function clientDirectory(scope: Scope): Promise<ClientRow[]> {
  if (scope !== null && scope.length === 0) return [];

  const visible =
    scope === null ? sql`true` : inArray(projects.id, scope);

  return db
    .select({
      id: clients.id,
      name: clients.name,
      industry: clients.industry,
      primaryContactName: clients.primaryContactName,
      primaryContactEmail: clients.primaryContactEmail,
      activeProjects: sql<number>`count(distinct ${projects.id}) filter (
        where ${projects.lifecycle} not in ('archived','completed'))::int`,
      totalProjects: sql<number>`count(distinct ${projects.id})::int`,
      loggedHours: sql<string>`coalesce(sum(${workLogs.hours}), 0)::text`,
      lastActivityAt: sql<string | null>`to_char(max(${workLogs.workDate}), 'YYYY-MM-DD')`,
    })
    .from(clients)
    .innerJoin(projects, and(eq(projects.clientId, clients.id), visible))
    // Left, not inner: a client whose projects have no hours yet is still a
    // client, and an inner join would hide exactly the new ones worth watching.
    .leftJoin(
      workLogs,
      and(eq(workLogs.projectId, projects.id), isNull(workLogs.deletedAt)),
    )
    .groupBy(clients.id)
    .orderBy(desc(sql`count(distinct ${projects.id}) filter (
      where ${projects.lifecycle} not in ('archived','completed'))`), asc(clients.name));
}

export type ClientDetail = {
  client: {
    id: string;
    name: string;
    industry: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    source: string | null;
    notes: string | null;
  };
  projects: {
    id: string;
    code: string;
    name: string;
    lifecycle: string;
    health: string;
    internalDueDate: Date | null;
    loggedHours: string;
  }[];
};

export async function clientDetail(
  clientId: string,
  scope: Scope,
): Promise<ClientDetail | null> {
  if (scope !== null && scope.length === 0) return null;

  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      industry: clients.industry,
      primaryContactName: clients.primaryContactName,
      primaryContactEmail: clients.primaryContactEmail,
      source: clients.source,
      notes: clients.notes,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      lifecycle: sql<string>`${projects.lifecycle}`,
      health: sql<string>`${projects.health}`,
      internalDueDate: projects.internalDueDate,
      // `projects.id` is written out rather than interpolated. Inside a
      // correlated subquery drizzle renders a column reference UNQUALIFIED —
      // `"id"` — which Postgres then resolves against the inner table, so
      // `w.project_id = "id"` compared a work log to its own id and matched
      // nothing. It returned 0 rather than erroring, which is the dangerous
      // part: a silently empty aggregate looks like "no hours logged".
      loggedHours: sql<string>`(
        select coalesce(sum(w.hours), 0)::text from work_logs w
         where w.project_id = projects.id and w.deleted_at is null)`,
    })
    .from(projects)
    .where(
      and(
        eq(projects.clientId, clientId),
        scope === null ? sql`true` : inArray(projects.id, scope),
      ),
    )
    .orderBy(asc(projects.name));

  // A client reachable only through projects you cannot see is, to you, not a
  // client at all — 404 rather than an empty page, matching how project ids
  // behave. Otherwise the directory becomes a list of who the agency works for.
  if (rows.length === 0) return null;

  return { client, projects: rows };
}
