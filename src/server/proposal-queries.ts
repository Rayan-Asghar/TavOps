import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { blockers, clients, projects, proposals, users } from "@/db/schema";
import { CHASE_AFTER_DAYS, CHASE_LIMIT } from "@/lib/chase";
import { HOURS_PER_DAY } from "@/lib/business-time";
import { offsetFor, type ListParams } from "@/lib/list-params";
import { OPEN_STATUSES, VIEW_STATUSES, type ProposalView } from "./proposal-schemas";

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

/**
 * SQL mirror of `chase.ts`: due when the clock since the last chase (or the
 * bid) has run past this status's allowance.
 *
 * The cutoff table lives in TypeScript because it is a product decision, so it
 * is interpolated into a CASE here rather than duplicated as a constant in the
 * database. Business hours are approximated by working days: the SQL only has
 * to decide which rows to fetch, and `chaseState` re-derives the exact answer
 * per row for display. Getting a borderline row into the list and then shown as
 * "not quite due" is a far cheaper error than paginating on one clock and
 * rendering on another.
 */
function chaseDuePredicate(): SQL {
  const cases = Object.entries(CHASE_AFTER_DAYS)
    .filter(([, days]) => days !== null)
    .map(([status, days]) => sql`when ${status} then ${days as number}`);
  /* The ::int is load-bearing. Bound parameters arrive untyped, so the CASE
     comes back as text and `text * interval` is not an operator Postgres has. */
  return sql`
    ${proposals.chaseCount} < ${CHASE_LIMIT}
    and coalesce(${proposals.lastChasedAt}, ${proposals.sentAt})
        < now() - (
          (case ${proposals.status}::text ${sql.join(cases, sql` `)} else null end)::int
          * interval '1 day'
        )`;
}

/** Statuses a chase can apply to at all. Won and lost are decided. */
const CHASEABLE = OPEN_STATUSES;

function viewFilter(view: ProposalView): SQL | undefined {
  const statuses = VIEW_STATUSES[view];
  const byStatus = statuses ? inArray(proposals.status, statuses) : undefined;
  if (view !== "chase") return byStatus;
  return and(byStatus, chaseDuePredicate());
}

/** Free-text over the things a rep would actually type: the job, the client. */
function searchFilter(q: string): SQL | undefined {
  if (!q) return undefined;
  const like = `%${q}%`;
  return or(
    ilike(proposals.jobTitle, like),
    ilike(proposals.category, like),
    ilike(clients.name, like),
  );
}

export type ProposalListOptions = {
  view: ProposalView;
  list: ListParams;
  /** Only meaningful with proposal.viewAll; ignored otherwise. */
  ownerId?: string | null;
};

const SORTABLE = ["sent", "value", "status", "cold"] as const;
export const PROPOSAL_SORT_KEYS: readonly string[] = SORTABLE;

function orderFor(list: ListParams) {
  const dir = list.desc ? desc : asc;
  switch (list.sort) {
    case "value":
      return dir(sql`coalesce(${proposals.wonValue}, ${proposals.budgetAmount}, 0)`);
    case "status":
      return dir(proposals.status);
    case "cold":
      // Oldest clock first is what a chase queue means by "most urgent".
      return dir(sql`coalesce(${proposals.lastChasedAt}, ${proposals.sentAt})`);
    default:
      return dir(proposals.sentAt);
  }
}

function scopeFor(actorId: string, seesAll: boolean, opts: ProposalListOptions) {
  return and(
    ownerFilter(actorId, seesAll),
    // An owner filter is a view control for somebody who can already see every
    // row; it must never be the thing that grants the seeing.
    seesAll && opts.ownerId ? eq(proposals.ownerId, opts.ownerId) : undefined,
    viewFilter(opts.view),
    searchFilter(opts.list.q),
  );
}

/**
 * One page of the pipeline.
 *
 * The hard `.limit(60)` this replaced was not pagination — it was a silent
 * truncation with no way to reach row 61, which meant the page quietly stopped
 * being a record of the pipeline once the team had bid on more than sixty jobs.
 */
export async function listProposals(
  actorId: string,
  seesAll: boolean,
  opts: ProposalListOptions,
) {
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
      lastChasedAt: proposals.lastChasedAt,
      chaseCount: proposals.chaseCount,
      lostReason: proposals.lostReason,
      wonValue: proposals.wonValue,
      wonProjectId: proposals.wonProjectId,
      clientId: proposals.clientId,
      clientName: clients.name,
      ownerName: users.name,
      ownerId: proposals.ownerId,
    })
    .from(proposals)
    .leftJoin(users, eq(proposals.ownerId, users.id))
    .leftJoin(clients, eq(proposals.clientId, clients.id))
    .where(scopeFor(actorId, seesAll, opts))
    .orderBy(orderFor(opts.list))
    .limit(opts.list.pageSize)
    .offset(offsetFor(opts.list));
}

/** The companion count, so Pagination can say how many there are. */
export async function countProposals(
  actorId: string,
  seesAll: boolean,
  opts: ProposalListOptions,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .leftJoin(clients, eq(proposals.clientId, clients.id))
    .where(scopeFor(actorId, seesAll, opts));
  return row?.n ?? 0;
}

/**
 * How many proposals are due a chase right now.
 *
 * Owner-scoped always, including for a head: the rail badge is a count of what
 * THIS person has to do today, and a company-wide number there is a statistic
 * dressed up as a task.
 */
export async function chaseDueCount(actorId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(
        eq(proposals.ownerId, actorId),
        inArray(proposals.status, CHASEABLE),
        chaseDuePredicate(),
      ),
    );
  return row?.n ?? 0;
}

/** Everything the sweep needs to decide, and to write a useful notification. */
export async function proposalsDueAChase() {
  return db
    .select({
      id: proposals.id,
      ownerId: proposals.ownerId,
      jobTitle: proposals.jobTitle,
      status: proposals.status,
      sentAt: proposals.sentAt,
      lastChasedAt: proposals.lastChasedAt,
      chaseCount: proposals.chaseCount,
    })
    .from(proposals)
    .where(
      and(
        inArray(proposals.status, CHASEABLE),
        chaseDuePredicate(),
      ),
    );
}

/** One proposal, with everything the detail route shows around it. */
export async function proposalDetail(id: string) {
  const [row] = await db
    .select({
      id: proposals.id,
      ownerId: proposals.ownerId,
      ownerName: users.name,
      jobTitle: proposals.jobTitle,
      jobUrl: proposals.jobUrl,
      category: proposals.category,
      source: proposals.source,
      budgetAmount: proposals.budgetAmount,
      currency: proposals.currency,
      status: proposals.status,
      sentAt: proposals.sentAt,
      respondedAt: proposals.respondedAt,
      meetingAt: proposals.meetingAt,
      decidedAt: proposals.decidedAt,
      lastChasedAt: proposals.lastChasedAt,
      chaseCount: proposals.chaseCount,
      lostReason: proposals.lostReason,
      lostNote: proposals.lostNote,
      wonValue: proposals.wonValue,
      wonProjectId: proposals.wonProjectId,
      notes: proposals.notes,
      clientId: proposals.clientId,
      clientName: clients.name,
      projectCode: projects.code,
      projectName: projects.name,
      projectLifecycle: projects.lifecycle,
      projectHealth: projects.health,
    })
    .from(proposals)
    .leftJoin(users, eq(proposals.ownerId, users.id))
    .leftJoin(clients, eq(proposals.clientId, clients.id))
    .leftJoin(projects, eq(proposals.wonProjectId, projects.id))
    .where(eq(proposals.id, id))
    .limit(1);
  return row ?? null;
}

/** The client list a rep may link to. Read-only: they never create one. */
export async function clientOptions() {
  return db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .orderBy(clients.name);
}

/** Options the handoff form needs: existing clients and assignable leads. */
export async function handoffOptions() {
  const [clientRows, staff] = await Promise.all([
    clientOptions(),
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

/**
 * Won proposals still missing a project — the handoff backlog.
 *
 * Scoped like every other read here. It used to count the whole company for
 * everybody, which was harmless only because the one caller happened to hold
 * project.create; showing a rep a number covering deals that are not theirs
 * would be a leak the moment the page rendered it to them.
 */
export async function pendingHandoffCount(
  actorId: string,
  seesAll: boolean,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(
        ownerFilter(actorId, seesAll),
        eq(proposals.status, "won"),
        isNull(proposals.wonProjectId),
      ),
    );
  return row?.n ?? 0;
}

/** Unused for now; `HOURS_PER_DAY` keeps the SQL and chase.ts in one story. */
export const CHASE_SHIFT_HOURS = HOURS_PER_DAY;

/**
 * Blockers that were routed TO this rep.
 *
 * `resolveBlockerRouting` has always sent the four client-side categories and
 * `commercial_scope` to the deal owner — "not the client's fault, but the rep
 * answers" — and that half of the model has never had a screen. A rep only ever
 * met it as a row on a project page they had little other reason to open.
 *
 * Assigned-to, not owner-side: what belongs on a rep's own queue is what
 * somebody actually put in their hands.
 */
export async function blockersAssignedTo(actorId: string) {
  return db
    .select({
      id: blockers.id,
      description: blockers.description,
      category: blockers.category,
      severity: blockers.severity,
      openedAt: blockers.createdAt,
      slaDueAt: blockers.slaDueAt,
      projectId: blockers.projectId,
      projectCode: projects.code,
    })
    .from(blockers)
    .innerJoin(projects, eq(blockers.projectId, projects.id))
    .where(
      and(eq(blockers.assignedToId, actorId), eq(blockers.status, "open")),
    )
    .orderBy(blockers.slaDueAt)
    .limit(10);
}
