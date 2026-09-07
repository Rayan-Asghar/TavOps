import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as sqlRaw } from "drizzle-orm";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

/** Next dev reloads modules on every edit; without this the pool leaks
 *  connections until Postgres refuses new ones. */
const globalForDb = globalThis as unknown as {
  tavrenPool?: ReturnType<typeof postgres>;
};

/**
 * Pool size, per process.
 *
 * Ten is right for one long-lived Node process. It is wrong on a serverless
 * host, where every concurrent invocation is its own process with its own pool:
 * ten instances become a hundred connections against a database that permits
 * far fewer, and the failure arrives as "too many clients" under exactly the
 * load that caused it.
 *
 * Those deployments put a transaction-mode pooler in front (Supabase's
 * Supavisor, PgBouncer), which is where pooling should happen — so each instance
 * wants the smallest pool that still lets ONE REQUEST RUN ITS QUERIES.
 * `prepare: false` below is the other half of that contract: a transaction
 * pooler hands each statement to whichever backend is free, and a statement
 * prepared on one is not there on the next.
 *
 * ## Why not 1
 *
 * `DATABASE_POOL_MAX=1` was the first answer and it is a trap, in two ways that
 * cost a working deployment:
 *
 *   - A pool of one SERIALISES `Promise.all`. The app shell issues four
 *     independent queries that way (`src/app/(app)/layout.tsx`), which at one
 *     connection is four round trips end to end instead of one — multiplied by
 *     however far the database is from the region the functions run in.
 *   - Anything that takes a connection OUT of the pool and then queries through
 *     the pool deadlocks against itself. `sync-worker.ts` did exactly that and
 *     every page on the deployment hung until Postgres cancelled the statement;
 *     the rejection then killed the process and truncated every response
 *     streaming from that instance. That code is fixed, but a pool of one is
 *     what turned a bug into an outage.
 *
 * Three is the working figure: enough that a request's parallel queries are
 * actually parallel, small enough that Supavisor's free-tier pool of 15 is not
 * at risk from concurrent instances. Raise it only alongside the pooler's own
 * limit, never past it.
 *
 * Left explicit rather than sniffed from a host's env var, so the value is
 * visible in the deployment that chose it.
 */
export const poolMax = Number(process.env.DATABASE_POOL_MAX) || 10;

const pool =
  globalForDb.tavrenPool ??
  postgres(connectionString, {
    max: poolMax,
    idle_timeout: 20,
    /**
     * Fail fast when the database cannot be reached at all.
     *
     * postgres.js waits forever by default, which turns "wrong host" or "no
     * network" into a hang rather than an error. A build that reaches for a
     * database it cannot see then dies on the framework's own 60s page timeout,
     * reporting only that a page took too long — which says nothing about the
     * connection and sends you looking at the page.
     */
    connect_timeout: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.tavrenPool = pool;
}

/*
 * The raw postgres.js pool is deliberately NOT exported.
 *
 * It used to be, for `reserve()` — the reasoning being that a session-level
 * advisory lock belongs to a connection, so taking it through the pool and
 * releasing it through the pool can release nothing at all. That reasoning is
 * correct and the conclusion was still wrong twice over, which
 * `src/server/sync-worker.ts` now records at length:
 *
 *   - `reserve()` against `DATABASE_POOL_MAX=1` takes the only connection, so
 *     anything the holder does through `db` deadlocks against itself;
 *   - and a session lock cannot survive a TRANSACTION POOLER anyway, which is
 *     what sits in front of this pool in every deployment that needs max=1.
 *
 * If you need a session-scoped lock, you need a connection this pool is not
 * multiplexing AND a pooler in session mode. Short of both, use
 * `pg_try_advisory_xact_lock` (see `src/server/scheduler.ts`) or a row-level
 * claim with `FOR UPDATE SKIP LOCKED`.
 */

export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;

/**
 * Opens a transaction with the finance RLS gate lifted.
 *
 * `project_financials` and `user_rates` return zero rows outside this helper —
 * see drizzle/0001_finance_rls_backstop.sql. Call it ONLY from a code path that
 * has already checked the caller holds `finance.view` / `rates.view`; the RLS
 * policy is a backstop against mistakes, not a substitute for that check.
 *
 * SET LOCAL scopes the flag to this transaction, so it cannot leak to the next
 * caller that borrows the same pooled connection.
 */
export async function withFinanceAccess<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sqlRaw`SET LOCAL tavren.finance_access = 'on'`);
    return fn(tx);
  });
}

/** A transaction handle, as handed to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The same gate, opened inside a transaction that is already running, and
 * closed again before that transaction continues.
 *
 * Costing has to happen in the SAME transaction as the work log it describes —
 * a cost row that commits while its entry rolls back is worse than no cost row,
 * the argument `writeAudit` already makes. But `recordWorkInTx` runs in a plain
 * `db.transaction`, which has no `tavren.finance_access`, so reading a rate
 * there returns nothing. Correctly.
 *
 * Wrapping the whole work-log write in `withFinanceAccess` would hold the gate
 * open across the audit write, the sheet enqueue and the notification fan-out —
 * far wider than the costing needs. A SECURITY DEFINER function would be worse
 * still: `tests/db/rls.test.ts` asserts the app role can neither bypass RLS nor
 * act as superuser, and a definer function owned by the superuser hands exactly
 * that back for one query shape, encoded in SQL where nobody reviews it.
 *
 * So: a savepoint, the flag on, the work, the flag off. Two mechanisms close
 * it, one per path. `SET LOCAL` may be issued repeatedly within a transaction
 * and the last value wins, so the explicit `'off'` shuts the window on the
 * success path; and `ROLLBACK TO SAVEPOINT` reverts a `SET LOCAL` made inside a
 * subtransaction, which covers the throw path.
 *
 * The reset is deliberately NOT in a `finally`. If `fn` failed on a SQL error
 * the subtransaction is already aborted, so the reset would itself throw
 * "current transaction is aborted" and mask the real error — swapping a
 * diagnosable failure for a confusing one, to close a window the rollback has
 * already closed.
 *
 * Like `withFinanceAccess`: the caller has already checked the capability. This
 * is the backstop, not the control.
 */
export async function withFinanceAccessInTx<T>(
  tx: Tx,
  fn: (sp: Tx) => Promise<T>,
): Promise<T> {
  return tx.transaction(async (sp) => {
    await sp.execute(sqlRaw`SET LOCAL tavren.finance_access = 'on'`);
    const result = await fn(sp);
    await sp.execute(sqlRaw`SET LOCAL tavren.finance_access = 'off'`);
    return result;
  });
}
