import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withFinanceAccess } from "@/db";
import { userRates, workLogCosts } from "@/db/schema";
import { makeProject, makeUser, owner, resetDb } from "./harness";

/**
 * Setting a rate, and the costing that depends on it.
 *
 * This is the loop Phase 1 left open: the costing engine existed and nothing in
 * the app could feed it. What matters here is not that a row is written, but
 * that the row written is the RIGHT SHAPE — a half-open chain with no gap and
 * no overlap — because a gap silently makes hours `unrated` and an overlap
 * silently makes them `ambiguous`, and both look like "the margin is missing".
 */

const state = vi.hoisted(() => ({
  actor: null as { id: string; globalRole: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getActor: async () => state.actor,
  requireActor: async () => {
    if (!state.actor) throw new Error("Not signed in.");
    return state.actor;
  },
}));

const { setUserRateAction } = await import("@/server/rate-actions");
const { recordWorkInTx } = await import("@/server/record-work");
const { db } = await import("@/db");

beforeEach(async () => {
  await resetDb();
  state.actor = null;
});
afterAll(async () => {
  await owner.end();
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const setRate = (fields: Record<string, string>) =>
  setUserRateAction({}, form(fields));

async function openRates(userId: string) {
  return withFinanceAccess((tx) =>
    tx
      .select()
      .from(userRates)
      .where(and(eq(userRates.userId, userId), isNull(userRates.effectiveTo))),
  );
}

describe("setting a rate", () => {
  it("opens the first rate for somebody who had none", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "admin" };

    const res = await setRate({
      userId,
      internalCostPerHour: "12.00",
      billableRatePerHour: "45.00",
      currency: "usd",
      effectiveFrom: "2026-01-01",
    });

    expect(res.ok).toBe(true);
    const rows = await openRates(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].internalCostPerHour).toBe("12.00");
    // Normalised, so a lowercase entry cannot create a second "currency".
    expect(rows[0].currency).toBe("USD");
  });

  it("closes the old rate on exactly the day the new one starts", async () => {
    // No gap and no overlap. resolveRate reads [from, to), so these two dates
    // being equal is what makes the chain continuous.
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "admin" };

    await setRate({
      userId,
      internalCostPerHour: "10.00",
      billableRatePerHour: "40.00",
      currency: "USD",
      effectiveFrom: "2026-01-01",
    });
    await setRate({
      userId,
      internalCostPerHour: "20.00",
      billableRatePerHour: "60.00",
      currency: "USD",
      effectiveFrom: "2026-07-01",
    });

    const all = await withFinanceAccess((tx) =>
      tx.select().from(userRates).where(eq(userRates.userId, userId)),
    );
    expect(all).toHaveLength(2);

    const closed = all.find((r) => r.effectiveTo !== null)!;
    const open = all.find((r) => r.effectiveTo === null)!;
    expect(closed.effectiveTo!.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(open.effectiveFrom.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(open.internalCostPerHour).toBe("20.00");

    // And exactly one row is open, which is what the partial unique index and
    // the resolver's refusal-to-guess both depend on.
    expect(await openRates(userId)).toHaveLength(1);
  });

  it("refuses a change dated before the current rate began", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "admin" };

    await setRate({
      userId,
      internalCostPerHour: "10.00",
      billableRatePerHour: "",
      currency: "USD",
      effectiveFrom: "2026-06-01",
    });
    const res = await setRate({
      userId,
      internalCostPerHour: "99.00",
      billableRatePerHour: "",
      currency: "USD",
      effectiveFrom: "2026-05-01",
    });

    expect(res.ok).toBeFalsy();
    expect(res.error).toMatch(/after the current one/i);
    expect(await openRates(userId)).toHaveLength(1);
  });

  it("stores a blank rate card as null, never as zero", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "admin" };

    await setRate({
      userId,
      internalCostPerHour: "10.00",
      billableRatePerHour: "",
      currency: "USD",
      effectiveFrom: "2026-01-01",
    });

    const [row] = await openRates(userId);
    expect(row.billableRatePerHour).toBeNull();
  });
});

describe("permission", () => {
  it("refuses a head, who runs the company but does not get pay data", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "head" };

    const res = await setRate({
      userId,
      internalCostPerHour: "10.00",
      billableRatePerHour: "",
      currency: "USD",
      effectiveFrom: "2026-01-01",
    });

    expect(res.ok).toBeFalsy();
    expect(await openRates(userId)).toHaveLength(0);
  });
});

describe("the audit row", () => {
  it("records the change WITHOUT the amounts", async () => {
    // head holds audit.view but not rates.view, so an amount written here is
    // readable at /audit by the role rbac.ts withholds pay data from.
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "admin" };

    await setRate({
      userId,
      internalCostPerHour: "12.34",
      billableRatePerHour: "56.78",
      currency: "USD",
      effectiveFrom: "2026-01-01",
    });

    const [row] = await owner`
      SELECT action, after FROM audit_log WHERE action = 'user.set_rate'`;
    expect(row.action).toBe("user.set_rate");

    const json = JSON.stringify(row.after);
    expect(json).not.toContain("12.34");
    expect(json).not.toContain("56.78");
    expect(json).toContain("2026-01-01");
  });
});

describe("the loop: a rate entered here is a cost on a work log", () => {
  it("costs an entry at the rate in force on its work date", async () => {
    const userId = await makeUser({});
    const projectId = await makeProject({});
    state.actor = { id: userId, globalRole: "admin" };

    await setRate({
      userId,
      internalCostPerHour: "10.00",
      billableRatePerHour: "40.00",
      currency: "USD",
      effectiveFrom: "2026-01-01",
    });
    await setRate({
      userId,
      internalCostPerHour: "20.00",
      billableRatePerHour: "80.00",
      currency: "USD",
      effectiveFrom: "2026-07-01",
    });

    const before = await db.transaction((tx) =>
      recordWorkInTx(tx, {
        projectId,
        userId,
        hours: 2,
        internalNotes: "Before the raise.",
        workDate: new Date("2026-06-15T12:00:00Z"),
      }),
    );
    const after = await db.transaction((tx) =>
      recordWorkInTx(tx, {
        projectId,
        userId,
        hours: 2,
        internalNotes: "After the raise.",
        workDate: new Date("2026-08-15T12:00:00Z"),
      }),
    );

    const costs = await withFinanceAccess((tx) =>
      tx.select().from(workLogCosts),
    );
    const byLog = new Map(costs.map((c) => [c.workLogId, c]));

    expect(byLog.get(before.entry.id)).toMatchObject({
      basis: "rated",
      costAmount: "20.00",
      revenueAmount: "80.00",
    });
    expect(byLog.get(after.entry.id)).toMatchObject({
      basis: "rated",
      costAmount: "40.00",
      revenueAmount: "160.00",
    });
  });
});
