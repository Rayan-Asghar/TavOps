import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, proposals, users } from "@/db/schema";

/**
 * Read side of the BD pipeline.
 *
 * Deliberately NOT in a "use server" module: every exported async function in
 * one becomes a callable server action, and these take an actorId, so a client
 * could simply pass somebody else's. Server components import them directly.
 */

/** A rep sees their own pipeline; heads and management see everyone's. */
function ownerFilter(actorId: string, seesAll: boolean) {
  return seesAll ? undefined : eq(proposals.ownerId, actorId);
}

/**
 * Visibility for the proposal LIST, which is wider than the stats scope: a
 * delivery lead owns no proposals but must see the ones routed to them for a
 * technical read, or they can never answer one.
 */
function listFilter(actorId: string, seesAll: boolean, canAnswerFeasibility: boolean) {
  if (seesAll) return undefined;
  if (!canAnswerFeasibility) return eq(proposals.ownerId, actorId);
  return or(
    eq(proposals.ownerId, actorId),
    and(
      eq(proposals.feasibilityAssignedToId, actorId),
      eq(proposals.feasibility, "pending"),
    ),
  );
}

export type BdStats = {
  sentToday: number;
  sentWeek: number;
  sentMonth: number;
  responsesToday: number;
  meetingsBooked: number;
  followUpsDue: number;
  feasibilityWaiting: number;
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
  const now = new Date().toISOString();

  const [row] = await db
    .select({
      sentToday: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${today}::timestamptz)::int`,
      sentWeek: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${week}::timestamptz)::int`,
      sentMonth: sql<number>`count(*) filter (where ${proposals.sentAt} >= ${month}::timestamptz)::int`,
      responsesToday: sql<number>`count(*) filter (where ${proposals.respondedAt} >= ${today}::timestamptz)::int`,
      meetingsBooked: sql<number>`count(*) filter (where ${proposals.meetingAt} is not null and ${proposals.meetingAt} >= ${month}::timestamptz)::int`,
      followUpsDue: sql<number>`count(*) filter (where ${proposals.followUpDueAt} <= ${now}::timestamptz and ${proposals.status} not in ('won','lost'))::int`,
      feasibilityWaiting: sql<number>`count(*) filter (where ${proposals.feasibility} = 'pending')::int`,
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
    followUpsDue: row?.followUpsDue ?? 0,
    feasibilityWaiting: row?.feasibilityWaiting ?? 0,
    wonMonth: row?.wonMonth ?? 0,
    wonValueMonth: row?.wonValueMonth ?? 0,
    responseRate: monthTotal ? ((row?.monthResponded ?? 0) / monthTotal) * 100 : 0,
    winRate: monthTotal ? ((row?.wonMonth ?? 0) / monthTotal) * 100 : 0,
  };
}

export async function listProposals(
  actorId: string,
  seesAll: boolean,
  canAnswerFeasibility = false,
) {
  const scope = listFilter(actorId, seesAll, canAnswerFeasibility);
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
      followUpDueAt: proposals.followUpDueAt,
      feasibility: proposals.feasibility,
      feasibilityNote: proposals.feasibilityNote,
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

/**
 * Response rate per category — the number that actually changes behaviour.
 * Volume says a rep is busy; this says which niches are worth bidding on.
 */
export async function conversionByCategory(actorId: string, seesAll: boolean) {
  const scope = ownerFilter(actorId, seesAll);
  return db
    .select({
      category: sql<string>`coalesce(${proposals.category}, 'Uncategorised')`,
      sent: sql<number>`count(*)::int`,
      responded: sql<number>`count(*) filter (where ${proposals.respondedAt} is not null)::int`,
      won: sql<number>`count(*) filter (where ${proposals.status} = 'won')::int`,
      wonValue: sql<number>`coalesce(sum(${proposals.wonValue}) filter (where ${proposals.status} = 'won'), 0)::float`,
    })
    .from(proposals)
    .where(scope)
    .groupBy(sql`coalesce(${proposals.category}, 'Uncategorised')`)
    .orderBy(sql`count(*) desc`)
    .limit(12);
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
