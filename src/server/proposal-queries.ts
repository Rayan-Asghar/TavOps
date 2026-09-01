import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, proposals, users } from "@/db/schema";

/**
 * Read side of the BD pipeline.
 *
 * Deliberately NOT in a "use server" module: every exported async function in
 * one becomes a callable server action, and these take an actorId, so a client
 * could simply pass somebody else's. Server components import them directly.
 *
 * Scope is deliberately narrow: what was sent, and what landed. The pipeline
 * carried feasibility routing and per-category rate economics once; both were
 * built for a BD team that does more analysis than this one does, and reporting
 * nobody reads is worse than no reporting.
 */

/** A rep sees their own pipeline; heads and management see everyone's. */
function ownerFilter(actorId: string, seesAll: boolean) {
  return seesAll ? undefined : eq(proposals.ownerId, actorId);
}

export type BdStats = {
  sentToday: number;
  sentWeek: number;
  sentMonth: number;
  responsesToday: number;
  meetingsBooked: number;
  wonMonth: number;
  wonValueMonth: number;
  responseRate: number;
  winRate: number;
};

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function bdStats(actorId: string, seesAll: boolean): Promise<BdStats> {
  const scope = ownerFilter(actorId, seesAll);
  // Interpolated as ISO strings with an explicit cast: a bare JS Date inside a
  // sql`` filter() clause gives the driver no type to bind against.
  const today = startOfDay().toISOString();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const month = new Date(Date.now() - 30 * 864e5).toISOString();

  const [row] = await db
    .select({
      sentToday: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${today}::timestamptz)::int`,
      sentWeek: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${week}::timestamptz)::int`,
      sentMonth: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${month}::timestamptz)::int`,
      responsesToday: sql<number>`count(*) filter (where ${proposals.respondedAt} >= ${today}::timestamptz)::int`,
      meetingsBooked: sql<number>`count(*) filter (where ${proposals.meetingAt} is not null and ${proposals.meetingAt} >= ${month}::timestamptz)::int`,
      wonMonth: sql<number>`count(*) filter (where ${proposals.status} = 'won' and ${proposals.decidedAt} >= ${month}::timestamptz)::int`,
      wonValueMonth: sql<number>`coalesce(sum(${proposals.wonValue}) filter (where ${proposals.status} = 'won' and ${proposals.decidedAt} >= ${month}::timestamptz), 0)::float`,
      monthTotal: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${month}::timestamptz)::int`,
      monthResponded: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${month}::timestamptz and ${proposals.respondedAt} is not null)::int`,
    })
    .from(proposals)
    .where(scope);

  const monthTotal = row?.monthTotal ?? 0;
  return {
    sentToday: row?.sentToday ?? 0,
    sentWeek: row?.sentWeek ?? 0,
    sentMonth: row?.sentMonth ?? 0,
    responsesToday: row?.responsesToday ?? 0,
    meetingsBooked: row?.meetingsBooked ?? 0,
    wonMonth: row?.wonMonth ?? 0,
    wonValueMonth: row?.wonValueMonth ?? 0,
    responseRate: monthTotal ? ((row?.monthResponded ?? 0) / monthTotal) * 100 : 0,
    winRate: monthTotal ? ((row?.wonMonth ?? 0) / monthTotal) * 100 : 0,
  };
}

export async function listProposals(actorId: string, seesAll: boolean) {
  const scope = ownerFilter(actorId, seesAll);
  return db
    .select({
      id: proposals.id,
      jobTitle: proposals.jobTitle,
      jobUrl: proposals.jobUrl,
      category: proposals.category,
      source: proposals.source,
      budgetAmount: proposals.budgetAmount,
      currency: proposals.currency,
      status: proposals.status,
      sentAt: proposals.sentAt,
      wonValue: proposals.wonValue,
      wonProjectId: proposals.wonProjectId,
      ownerName: users.name,
      ownerId: proposals.ownerId,
    })
    .from(proposals)
    .leftJoin(users, eq(proposals.ownerId, users.id))
    .where(scope)
    .orderBy(desc(proposals.sentAt))
    .limit(60);
}

/** Options the handoff form needs: existing clients and assignable leads. */
export async function handoffOptions() {
  const [clientRows, staff] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(clients.name),
    db
      .select({ id: users.id, name: users.name, role: users.globalRole })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.name),
  ]);
  return {
    clients: clientRows,
    // Both lists are the heads now; kept as two fields so the handoff form can
    // still name a PM and a delivery lead separately per project.
    leads: staff.filter((u) => u.role === "head").map(({ id, name }) => ({ id, name })),
    pms: staff.filter((u) => u.role === "head").map(({ id, name }) => ({ id, name })),
  };
}

/** Won proposals still missing a project — the handoff backlog. */
export async function pendingHandoffCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(sql`${proposals.status} = 'won' and ${proposals.wonProjectId} is null`);
  return row?.n ?? 0;
}
