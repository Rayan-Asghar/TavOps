import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { connectLedger, proposals, users } from "@/db/schema";
import { connectsHealth, type ConnectsHealth } from "@/lib/connects";
import { businessDaysBetween, HOURS_PER_DAY } from "@/lib/business-time";
import { offsetFor, type ListParams } from "@/lib/list-params";

/**
 * Read side of the connect ledger.
 *
 * A plain module, never `"use server"` — every export of one is a callable
 * endpoint, and these take no actor because the balance is not per-person.
 *
 * The balance is DERIVED on every read: `sum(delta)`, never cached. At a few
 * hundred rows a month a stored balance is a second source of truth that will
 * drift from the ledger it is supposed to summarise, which is the exact failure
 * this table exists to avoid. `::int` and never `::float`, per the house rule.
 */

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Calendar days the burn rate is averaged over. Long enough to ride a quiet week. */
const BURN_WINDOW_CALENDAR_DAYS = 14;

export async function connectsBalance(tx: Tx = db): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(sum(${connectLedger.delta}), 0)::int` })
    .from(connectLedger);
  return row?.n ?? 0;
}

/** Connects spent (as a positive number) over the burn window. */
function burnWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - BURN_WINDOW_CALENDAR_DAYS * 24 * 3600 * 1000);
}

async function spentRecently(tx: Tx = db): Promise<number> {
  const since = burnWindowStart();
  const [row] = await tx
    .select({
      n: sql<number>`coalesce(-sum(${connectLedger.delta}) filter (
        where ${connectLedger.kind} in ('bid', 'boost')
      ), 0)::int`,
    })
    .from(connectLedger)
    .where(gte(connectLedger.occurredAt, since));
  return row?.n ?? 0;
}

export async function connectsStatus(tx: Tx = db): Promise<ConnectsHealth> {
  const now = new Date();
  const [balance, spent] = await Promise.all([
    connectsBalance(tx),
    spentRecently(tx),
  ]);
  /* Divide by the WORKING days in the window, not the calendar days in it.
     Bids are placed on working days and the tile reads "working days of
     bidding left", so dividing a fortnight's spend by fourteen understated the
     burn by roughly a third and overstated the runway by roughly a quarter —
     on the one number somebody would plan a week of bidding against. */
  return connectsHealth({
    balance,
    spentInWindow: spent,
    windowDays: businessDaysBetween(burnWindowStart(now), now),
  });
}

export type ReconcileInfo = {
  at: Date;
  drift: number;
  note: string | null;
} | null;

/**
 * The last time somebody squared this against Upwork, and by how much.
 *
 * Rendered beside the balance because the honest thing about this ledger is
 * that it drifts: Upwork grants connects nobody records, refunds its own, and
 * expires the rest. "Last reconciled 12 days ago (was 8 short)" is what keeps
 * the number from decaying into fiction. It is not decoration.
 */
export async function lastReconcile(tx: Tx = db): Promise<ReconcileInfo> {
  const [row] = await tx
    .select({
      at: connectLedger.occurredAt,
      drift: connectLedger.delta,
      note: connectLedger.note,
    })
    .from(connectLedger)
    .where(eq(connectLedger.kind, "reconcile"))
    .orderBy(desc(connectLedger.occurredAt))
    .limit(1);
  return row ?? null;
}

/** What we paid for connects in a window, in cents. Purchases only. */
export async function connectsSpendCents(sinceDays = 30, tx: Tx = db): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
  const [row] = await tx
    .select({
      // ::bigint, not ::float — money aggregates never go through a double.
      cents: sql<string>`coalesce(sum(${connectLedger.amountCents}), 0)::bigint::text`,
    })
    .from(connectLedger)
    .where(
      and(eq(connectLedger.kind, "purchase"), gte(connectLedger.occurredAt, since)),
    );
  return Number(row?.cents ?? 0);
}

export async function listLedger(list: ListParams) {
  return db
    .select({
      id: connectLedger.id,
      kind: connectLedger.kind,
      delta: connectLedger.delta,
      occurredAt: connectLedger.occurredAt,
      amountCents: connectLedger.amountCents,
      currency: connectLedger.currency,
      note: connectLedger.note,
      proposalId: connectLedger.proposalId,
      jobTitle: proposals.jobTitle,
      recordedBy: users.name,
    })
    .from(connectLedger)
    .leftJoin(proposals, eq(connectLedger.proposalId, proposals.id))
    .leftJoin(users, eq(connectLedger.recordedById, users.id))
    .orderBy(desc(connectLedger.occurredAt))
    .limit(list.pageSize)
    .offset(offsetFor(list));
}

export async function countLedger(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(connectLedger);
  return row?.n ?? 0;
}

/** What one proposal cost to place. Two rows at most: the bid and the boost. */
export async function connectsForProposal(proposalId: string) {
  return db
    .select({
      kind: connectLedger.kind,
      delta: connectLedger.delta,
      occurredAt: connectLedger.occurredAt,
    })
    .from(connectLedger)
    .where(eq(connectLedger.proposalId, proposalId))
    .orderBy(connectLedger.occurredAt);
}

/** Kept beside the burn window so both read from one definition of a day. */
export const BURN_WINDOW = {
  calendarDays: BURN_WINDOW_CALENDAR_DAYS,
  hoursPerDay: HOURS_PER_DAY,
};
