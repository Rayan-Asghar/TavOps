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

const pool =
  globalForDb.tavrenPool ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.tavrenPool = pool;
}

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
