import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import { projectFinancials, userRates, workLogCosts } from "@/db/schema";
import {
  makeCost,
  makeFinancials,
  makeProject,
  makeRate,
  makeUser,
  makeWorkLog,
  owner,
  resetDb,
} from "./harness";

/**
 * The finance RLS backstop, against a real database.
 *
 * App-layer RBAC is the real access control; this exists so a forgotten WHERE
 * clause or a careless future join cannot leak contract value or what people
 * are paid. It is a database feature, so it can only be tested against one —
 * and it is the kind of guard that can silently stop working (a superuser
 * connection string, a dropped policy) while every other test still passes.
 */

beforeEach(resetDb);
afterAll(async () => {
  await owner.end();
});

describe("project_financials", () => {
  it("returns nothing to an ordinary query, even though the row exists", async () => {
    const projectId = await makeProject({});
    await makeFinancials(projectId, "50000.00");

    const rows = await db
      .select()
      .from(projectFinancials)
      .where(eq(projectFinancials.projectId, projectId));

    expect(rows).toEqual([]);
  });

  it("returns the row inside withFinanceAccess", async () => {
    const projectId = await makeProject({});
    await makeFinancials(projectId, "50000.00");

    const rows = await withFinanceAccess((tx) =>
      tx
        .select()
        .from(projectFinancials)
        .where(eq(projectFinancials.projectId, projectId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].contractValue).toBe("50000.00");
  });

  it("refuses an insert that has not opted in", async () => {
    const projectId = await makeProject({});
    await expect(
      db.insert(projectFinancials).values({
        projectId,
        contractValue: "1.00",
      }),
    ).rejects.toThrow();
  });
});

describe("user_rates", () => {
  it("hides pay data from an ordinary query", async () => {
    const userId = await makeUser({});
    await makeRate(userId, "12.50");

    const rows = await db
      .select()
      .from(userRates)
      .where(eq(userRates.userId, userId));

    expect(rows).toEqual([]);
  });

  it("returns pay data inside withFinanceAccess", async () => {
    const userId = await makeUser({});
    await makeRate(userId, "12.50");

    const rows = await withFinanceAccess((tx) =>
      tx.select().from(userRates).where(eq(userRates.userId, userId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].internalCostPerHour).toBe("12.50");
  });
});

describe("work_log_costs", () => {
  async function costedLog() {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    const { id, revisionId } = await makeWorkLog({ projectId, userId });
    await makeCost({
      workLogId: id,
      revisionId,
      costAmount: "31.25",
      revenueAmount: "125.00",
    });
    return id;
  }

  it("hides what an hour cost from an ordinary query", async () => {
    const workLogId = await costedLog();

    const rows = await db
      .select()
      .from(workLogCosts)
      .where(eq(workLogCosts.workLogId, workLogId));

    expect(rows).toEqual([]);
  });

  it("returns the cost inside withFinanceAccess", async () => {
    const workLogId = await costedLog();

    const rows = await withFinanceAccess((tx) =>
      tx
        .select()
        .from(workLogCosts)
        .where(eq(workLogCosts.workLogId, workLogId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].costAmount).toBe("31.25");
    expect(rows[0].revenueAmount).toBe("125.00");
  });

  it("refuses an insert that has not opted in", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    const { id, revisionId } = await makeWorkLog({ projectId, userId });

    await expect(
      db.insert(workLogCosts).values({
        workLogId: id,
        revisionId,
        basis: "rated",
        costAmount: "1.00",
      }),
    ).rejects.toThrow();
  });

  it("keeps every cost-bearing column OFF work_logs", async () => {
    // The reason work_log_costs is a separate table at all. work_logs is read
    // by the grid, both CSV exports and reports.ts::timesheet, none of which
    // open the finance gate — so a rate or cost column landing here would
    // retire the backstop silently, with every other test still passing.
    const rows = await owner`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'work_logs'
         AND (column_name LIKE '%cost%' OR column_name LIKE '%rate%')`;

    expect(rows.map((r) => r.column_name)).toEqual([]);
  });
});

describe("the opt-in is scoped to its transaction", () => {
  it("does not leak to the next query on the same pooled connection", async () => {
    const projectId = await makeProject({});
    await makeFinancials(projectId, "50000.00");

    const inside = await withFinanceAccess((tx) =>
      tx.select().from(projectFinancials),
    );
    expect(inside).toHaveLength(1);

    // SET LOCAL, not SET: the flag dies with the transaction. If this ever
    // returns a row, the pool is handing out finance access to whoever
    // borrows the connection next.
    const after = await db.select().from(projectFinancials);
    expect(after).toEqual([]);
  });

  it("closes access again after a failed opt-in transaction", async () => {
    const projectId = await makeProject({});
    await makeFinancials(projectId, "50000.00");

    await expect(
      withFinanceAccess(async (tx) => {
        await tx.select().from(projectFinancials);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.select().from(projectFinancials)).toEqual([]);
  });
});

describe("the configuration the backstop depends on", () => {
  it("keeps RLS enabled AND forced on every protected table", async () => {
    // ENABLE alone exempts the table owner. FORCE is what removes that
    // exemption, and a future migration recreating either table would silently
    // drop both flags — the policies would still exist and read as protection.
    const rows = await owner`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
       WHERE relname IN ('project_financials', 'user_rates', 'work_log_costs')`;

    // Deliberately a count and not a subset check: a new table joining the
    // finance family has to be added here consciously.
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} RLS forced`).toBe(true);
    }
  });

  it("leaves connect_ledger deliberately UNprotected", async () => {
    /* Recorded as a decision rather than left as an absence, because the next
       reader will reasonably ask why a money-adjacent table is not behind the
       gate. The 0001 backstop exists for contract value and for pay -- the two
       things whose leak damages a person. Connects cost pennies, everyone who
       may bid needs the balance in order to know whether they can, and gating
       it would drag withFinanceAccess into the hourly sweep and onto a screen
       with no finance on it. If this ever needs protecting, this test failing
       is the prompt to think about it. */
    const [row] = await owner`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'connect_ledger'`;
    expect(row).toBeDefined();
    expect(row.relrowsecurity).toBe(false);
  });

  it("keeps a policy on each protected table", async () => {
    const rows = await owner`
      SELECT tablename FROM pg_policies
       WHERE tablename IN ('project_financials', 'user_rates', 'work_log_costs')`;
    expect(new Set(rows.map((r) => r.tablename))).toEqual(
      new Set(["project_financials", "user_rates", "work_log_costs"]),
    );
  });

  it("connects the app as a role that cannot bypass RLS", async () => {
    // This is the load-bearing precondition, and the easiest to lose: a
    // superuser — or any role with BYPASSRLS — ignores every policy above,
    // FORCE included, and the backstop becomes decorative with nothing failing.
    // The dev owner IS a superuser, which is exactly why the app must not
    // share its connection string.
    const [row] = await db.execute<{ super: boolean; bypass: boolean }>(sql`
      SELECT rolsuper AS super, rolbypassrls AS bypass
        FROM pg_roles WHERE rolname = current_user`);

    expect(row.super, "app role is a superuser").toBe(false);
    expect(row.bypass, "app role has BYPASSRLS").toBe(false);
  });
});
