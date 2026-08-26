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
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sqlRaw`SET LOCAL tavren.finance_access = 'on'`);
    return fn(tx);
  });
}
