import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import { workLogCosts } from "@/db/schema";
import { recordWorkInTx } from "@/server/record-work";
import {
  makeProject,
  makeRate,
  makeTask,
  makeTaskType,
  makeUser,
  owner,
  resetDb,
} from "./harness";

/**
 * Costing, against a real database.
 *
 * The rate resolver and the arithmetic are unit-tested and need no database.
 * What can only be tested here is the wiring: that a cost is written in the
 * same transaction as its work log, that billability is inherited without
 * anybody choosing it, and — the one most likely to rot — that the finance
 * window costing opens is closed again before the transaction continues.
 */

beforeEach(resetDb);
afterAll(async () => {
  await owner.end();
});

async function costOf(workLogId: string) {
  const [row] = await withFinanceAccess((tx) =>
    tx
      .select()
      .from(workLogCosts)
      .where(eq(workLogCosts.workLogId, workLogId)),
  );
  return row;
}

async function logWork(opts: {
  projectId: string;
  userId: string;
  taskId?: string | null;
  taskTypeId?: string | null;
  billable?: boolean | null;
  hours?: number;
  workDate?: Date;
}) {
  return db.transaction((tx) =>
    recordWorkInTx(tx, {
      projectId: opts.projectId,
      userId: opts.userId,
      taskId: opts.taskId ?? null,
      taskTypeId: opts.taskTypeId ?? null,
      billable: opts.billable ?? null,
      hours: opts.hours ?? 2,
      internalNotes: "Did the thing.",
      workDate: opts.workDate,
    }),
  );
}

describe("costing a work log", () => {
  it("writes the cost in the same transaction as the entry", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "12.50", { billableRate: "50.00" });

    const { entry } = await logWork({ projectId, userId, hours: 2.5 });

    const cost = await costOf(entry.id);
    expect(cost.basis).toBe("rated");
    expect(cost.costAmount).toBe("31.25");
    expect(cost.revenueAmount).toBe("125.00");
    expect(cost.revisionId).toBeTruthy();
  });

  it("leaves no cost behind when the work log rolls back", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "12.50");

    await expect(
      db.transaction(async (tx) => {
        await recordWorkInTx(tx, {
          projectId,
          userId,
          hours: 1,
          internalNotes: "About to fail.",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await withFinanceAccess((tx) =>
      tx.select().from(workLogCosts),
    );
    expect(rows).toEqual([]);
  });

  it("records 'unrated' with NULL amounts when the person has no rate", async () => {
    // Not zero. A zero-cost entry inflates margin and reads as a fact; null
    // reads as "we do not know", and Reports counts the hours as not costed.
    const projectId = await makeProject({});
    const userId = await makeUser({});

    const { entry } = await logWork({ projectId, userId });

    const cost = await costOf(entry.id);
    expect(cost.basis).toBe("unrated");
    expect(cost.costAmount).toBeNull();
    expect(cost.revenueAmount).toBeNull();
  });

  it("does not let a rate added later restate an entry already costed", async () => {
    // The whole argument for snapshotting rather than resolving at read time.
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "10.00", {
      billableRate: "40.00",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-09-01T00:00:00Z",
    });

    const { entry } = await logWork({
      projectId,
      userId,
      hours: 1,
      workDate: new Date("2026-08-15T12:00:00Z"),
    });
    expect((await costOf(entry.id)).costAmount).toBe("10.00");

    await makeRate(userId, "99.00", { effectiveFrom: "2026-09-01T00:00:00Z" });

    expect((await costOf(entry.id)).costAmount).toBe("10.00");
  });

  it("costs the rate in force on the WORK date, not on the day it was typed", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "10.00", {
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-06-01T00:00:00Z",
    });
    await makeRate(userId, "20.00", { effectiveFrom: "2026-06-01T00:00:00Z" });

    const { entry } = await logWork({
      projectId,
      userId,
      hours: 1,
      workDate: new Date("2026-03-10T12:00:00Z"),
    });

    expect((await costOf(entry.id)).costAmount).toBe("10.00");
  });
});

describe("billability, inherited", () => {
  it("marks Business Development non-billable with nobody touching a checkbox", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "10.00", { billableRate: "40.00" });
    const bd = await makeTaskType({ name: "Business Development", billable: false });
    const taskId = await makeTask({ projectId, assigneeId: userId });
    await owner`UPDATE tasks SET task_type_id = ${bd} WHERE id = ${taskId}`;

    const { entry, revision } = await logWork({
      projectId,
      userId,
      taskId,
      hours: 2,
    });

    const [log] = await owner`SELECT billable FROM work_logs WHERE id = ${entry.id}`;
    expect(log.billable).toBe(false);

    const [rev] =
      await owner`SELECT billable FROM worklog_revisions WHERE id = ${revision.id}`;
    expect(rev.billable).toBe(false);

    // Cost still applies: the work happened and it was paid for.
    const cost = await costOf(entry.id);
    expect(cost.costAmount).toBe("20.00");
    expect(cost.revenueAmount).toBe("0.00");
  });

  it("lets an explicit false beat a billable task type", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    const design = await makeTaskType({ name: "Design", billable: true });
    const taskId = await makeTask({ projectId, assigneeId: userId });
    await owner`UPDATE tasks SET task_type_id = ${design} WHERE id = ${taskId}`;

    const { entry } = await logWork({
      projectId,
      userId,
      taskId,
      billable: false,
    });

    const [log] = await owner`SELECT billable FROM work_logs WHERE id = ${entry.id}`;
    expect(log.billable).toBe(false);
  });

  it("defaults to billable when nothing classifies the work", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});

    const { entry } = await logWork({ projectId, userId });

    const [log] = await owner`SELECT billable FROM work_logs WHERE id = ${entry.id}`;
    expect(log.billable).toBe(true);
  });
});

describe("the finance window costing opens", () => {
  it("is shut again before the rest of the transaction runs", async () => {
    // If this ever returns a row, costing has left the gate open for every
    // statement after it in the same transaction — which on the work-log path
    // means the audit write, the notification fan-out and the sheet enqueue.
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "12.50");

    const seen = await db.transaction(async (tx) => {
      await recordWorkInTx(tx, {
        projectId,
        userId,
        hours: 1,
        internalNotes: "Did the thing.",
      });
      // Same transaction, after costWorkLogInTx has returned.
      return tx.select().from(workLogCosts);
    });

    expect(seen).toEqual([]);
  });
});
