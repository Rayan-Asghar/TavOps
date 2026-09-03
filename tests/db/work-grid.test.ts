import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  owner,
  resetDb,
  makeUser,
  makeProject,
  addMember,
  makeWorkLog,
  makeConnection,
  setInvoicedThrough,
  revisionsFor,
  auditFor,
  logRow,
  logsFor,
  jobsFor,
} from "./harness";

/** Same three mocks as work-log-actions.test.ts, for the same reasons. */
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

const { saveWorkLogGrid } = await import("@/server/work-logs");

const key = () => randomUUID();

async function scenario() {
  const dev = await makeUser({ role: "developer", name: "Ahmed" });
  const other = await makeUser({ role: "developer", name: "Sara" });
  const projectId = await makeProject({ code: "ACME" });
  await addMember(projectId, dev, "developer");
  await addMember(projectId, other, "developer");
  state.actor = { id: dev, globalRole: "developer" };
  return { dev, other, projectId };
}

const save = (over: Record<string, unknown>) =>
  saveWorkLogGrid({ month: "2026-09", ...over });

const create = (over: Record<string, unknown> = {}) => ({
  op: "create",
  rowKey: key(),
  workDate: "2026-09-03",
  hours: 2,
  internalNotes: "Did the thing.",
  ...over,
});

beforeEach(async () => {
  await resetDb();
  state.actor = null;
});
afterAll(() => owner.end());

describe("creating", () => {
  it("writes twelve entries, each with its v1 revision", async () => {
    const { dev, projectId } = await scenario();

    const result = await save({
      projectId,
      personId: dev,
      rows: Array.from({ length: 12 }, (_, i) =>
        create({ hours: i + 1, internalNotes: `Entry ${i + 1}` }),
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(12);
    const logs = await logsFor(projectId, dev);
    expect(logs).toHaveLength(12);
    for (const l of logs) {
      expect(await revisionsFor(l.id)).toHaveLength(1);
    }
  });

  it("attributes an entry typed into somebody else's column to them, audited as you", async () => {
    const { other, projectId } = await scenario();
    const head = await makeUser({ role: "head", name: "Lead" });
    state.actor = { id: head, globalRole: "head" };

    const result = await save({
      projectId,
      personId: other,
      reason: "Logging on their behalf while they are away.",
      rows: [create({ userId: other })],
    });

    expect(result.ok).toBe(true);
    const [log] = await logsFor(projectId, other);
    // The work is theirs...
    expect((await logRow(log.id)).user_id).toBe(other);
    // ...but the record of who typed it names the lead.
    expect((await revisionsFor(log.id))[0].changed_by_user_id).toBe(head);
    expect((await auditFor(log.id))[0].actor_id).toBe(head);
  });

  it("refuses to log as somebody else without worklog.edit", async () => {
    const { other, projectId } = await scenario();

    const result = await save({
      projectId,
      rows: [create({ userId: other })],
    });

    expect(result.ok).toBe(false);
    expect(result.rows?.[0]).toMatchObject({ status: "rejected" });
    expect(await logsFor(projectId, other)).toHaveLength(0);
  });

  it("refuses a date outside the month being edited", async () => {
    const { dev, projectId } = await scenario();

    const result = await save({
      projectId,
      personId: dev,
      rows: [create({ workDate: "2026-10-01" })],
    });

    expect(result.rows?.[0]).toMatchObject({ status: "rejected" });
    expect(String((result.rows?.[0] as { error: string }).error)).toMatch(
      /outside the month/,
    );
  });

  it("refuses a new entry inside a billed period", async () => {
    const { dev, projectId } = await scenario();
    await setInvoicedThrough(projectId, "2026-09-30");

    const result = await save({ projectId, personId: dev, rows: [create()] });

    expect(result.rows?.[0]).toMatchObject({ status: "rejected" });
    expect(await logsFor(projectId, dev)).toHaveLength(0);
  });
});

describe("partial success", () => {
  it("saves nineteen rows and rejects the one that is billed", async () => {
    const { dev, projectId } = await scenario();
    await setInvoicedThrough(projectId, "2026-09-02");

    const rows = [
      create({ workDate: "2026-09-01" }), // inside the billed period
      ...Array.from({ length: 19 }, () => create({ workDate: "2026-09-10" })),
    ];
    const result = await save({ projectId, personId: dev, rows });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("19 saved, 1 could not be.");
    expect(await logsFor(projectId, dev)).toHaveLength(19);
  });

  it("leaves no revision, no audit row and no sheet job behind a rejected row", async () => {
    // The savepoint contract, and the reason the whole batch is one transaction
    // rather than one per row.
    const { dev, projectId } = await scenario();
    await makeConnection({ projectId });
    await setInvoicedThrough(projectId, "2026-09-05");
    const billed = await makeWorkLog({
      projectId,
      userId: dev,
      hours: "2.00",
      workDate: "2026-09-01",
    });
    const free = await makeWorkLog({
      projectId,
      userId: dev,
      hours: "2.00",
      workDate: "2026-09-20",
    });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: billed.id,
          expectedRevisionId: billed.revisionId,
          workDate: "2026-09-01",
          hours: 9,
          internalNotes: "Should not land.",
        },
        {
          op: "update",
          rowKey: key(),
          workLogId: free.id,
          expectedRevisionId: free.revisionId,
          workDate: "2026-09-20",
          hours: 5,
          internalNotes: "Should land.",
        },
      ],
    });

    expect(result.rows?.filter((r) => r.status === "rejected")).toHaveLength(1);

    // The rejected row is untouched, in every table.
    expect(await revisionsFor(billed.id)).toHaveLength(1);
    expect(await auditFor(billed.id)).toHaveLength(0);
    expect(await jobsFor(billed.id)).toHaveLength(0);
    expect((await logRow(billed.id)).hours).toBe("2.00");

    // The good row committed in the same transaction.
    expect((await logRow(free.id)).hours).toBe("5.00");
    expect(await jobsFor(free.id)).toHaveLength(1);
  });

  it("refuses the whole batch over the row cap, writing nothing", async () => {
    const { dev, projectId } = await scenario();

    const result = await save({
      projectId,
      personId: dev,
      rows: Array.from({ length: 201 }, () => create()),
    });

    expect(result.error).toMatch(/at most 200 rows/);
    expect(await logsFor(projectId, dev)).toHaveLength(0);
  });
});

describe("updating", () => {
  it("writes nothing at all when the values already match", async () => {
    // Saving on blur means most cells arrive unchanged; a v2 identical to v1
    // is noise in the chain and a wasted write to Google.
    const { dev, projectId } = await scenario();
    await makeConnection({ projectId });
    const log = await makeWorkLog({
      projectId,
      userId: dev,
      hours: "2.50",
      notes: "Did the thing.",
      workDate: "2026-09-10",
    });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: log.id,
          expectedRevisionId: log.revisionId,
          workDate: "2026-09-10",
          hours: 2.5,
          internalNotes: "Did the thing.",
        },
      ],
    });

    expect(result.rows?.[0]).toMatchObject({ status: "unchanged" });
    expect(await revisionsFor(log.id)).toHaveLength(1);
    expect(await auditFor(log.id)).toHaveLength(0);
    expect(await jobsFor(log.id)).toHaveLength(0);
  });

  it("rejects a stale row while the rest of the batch saves", async () => {
    const { dev, projectId } = await scenario();
    const stale = await makeWorkLog({ projectId, userId: dev, workDate: "2026-09-10" });
    const fresh = await makeWorkLog({ projectId, userId: dev, workDate: "2026-09-11" });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: stale.id,
          expectedRevisionId: randomUUID(), // somebody else moved it on
          workDate: "2026-09-10",
          hours: 4,
          internalNotes: "Mine.",
        },
        {
          op: "update",
          rowKey: key(),
          workLogId: fresh.id,
          expectedRevisionId: fresh.revisionId,
          workDate: "2026-09-11",
          hours: 4,
          internalNotes: "Also mine.",
        },
      ],
    });

    const rejected = result.rows?.find((r) => r.status === "rejected");
    expect(String((rejected as { error: string }).error)).toMatch(
      /changed this entry while you had it open/,
    );
    expect((await logRow(stale.id)).hours).toBe("2.50");
    expect((await logRow(fresh.id)).hours).toBe("4.00");
  });

  it("reads an entry from another project as missing", async () => {
    const { dev, projectId } = await scenario();
    const elsewhere = await makeProject({ code: "OTHER" });
    await addMember(elsewhere, dev, "developer");
    const theirs = await makeWorkLog({ projectId: elsewhere, userId: dev });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: theirs.id,
          expectedRevisionId: theirs.revisionId,
          workDate: "2026-09-01",
          hours: 4,
          internalNotes: "Not here.",
        },
      ],
    });

    expect(String((result.rows?.[0] as { error: string }).error)).toMatch(
      /no longer exists/,
    );
  });

  it("demands a reason before changing somebody else's row", async () => {
    const { other, projectId } = await scenario();
    const head = await makeUser({ role: "head" });
    const theirs = await makeWorkLog({
      projectId,
      userId: other,
      workDate: "2026-09-10",
    });
    state.actor = { id: head, globalRole: "head" };

    const withoutReason = await save({
      projectId,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: theirs.id,
          expectedRevisionId: theirs.revisionId,
          workDate: "2026-09-10",
          hours: 4,
          internalNotes: "Corrected.",
        },
      ],
    });
    expect(String((withoutReason.rows?.[0] as { error: string }).error)).toMatch(
      /Say why you are changing someone else/,
    );

    const withReason = await save({
      projectId,
      reason: "Double counted against the wrong task.",
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: theirs.id,
          expectedRevisionId: theirs.revisionId,
          workDate: "2026-09-10",
          hours: 4,
          internalNotes: "Corrected.",
        },
      ],
    });
    expect(withReason.ok).toBe(true);
    expect((await revisionsFor(theirs.id))[1].reason).toMatch(/Double counted/);
  });

  it("lets you correct your own row with no reason at all", async () => {
    const { dev, projectId } = await scenario();
    const mine = await makeWorkLog({
      projectId,
      userId: dev,
      workDate: "2026-09-10",
    });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "update",
          rowKey: key(),
          workLogId: mine.id,
          expectedRevisionId: mine.revisionId,
          workDate: "2026-09-10",
          hours: 6,
          internalNotes: "Took longer.",
        },
      ],
    });

    expect(result.ok).toBe(true);
    const revisions = await revisionsFor(mine.id);
    expect(revisions[1].reason).toBeNull();
    // The audit still says what moved, and that it came from the grid.
    expect((await auditFor(mine.id))[0].after).toMatchObject({ via: "grid" });
  });
});

describe("removing", () => {
  it("reverses an entry and leaves the row standing", async () => {
    const { dev, projectId } = await scenario();
    const mine = await makeWorkLog({
      projectId,
      userId: dev,
      workDate: "2026-09-10",
    });

    const result = await save({
      projectId,
      personId: dev,
      rows: [
        {
          op: "remove",
          rowKey: key(),
          workLogId: mine.id,
          expectedRevisionId: mine.revisionId,
        },
      ],
    });

    expect(result.rows?.[0]).toMatchObject({ status: "removed" });
    const revisions = await revisionsFor(mine.id);
    expect(revisions[1]).toMatchObject({ hours: "0.00", is_reversal: true });
    expect((await logRow(mine.id)).deleted_at).not.toBeNull();
  });
});

describe("the sheet outbox", () => {
  it("queues one job per row and nothing when the project has no sheet", async () => {
    const { dev, projectId } = await scenario();
    const withoutSheet = await save({
      projectId,
      personId: dev,
      rows: [create(), create()],
    });
    expect(withoutSheet.ok).toBe(true);
    for (const l of await logsFor(projectId, dev)) {
      expect(await jobsFor(l.id)).toHaveLength(0);
    }

    await resetDb();
    const s2 = await scenario();
    await makeConnection({ projectId: s2.projectId });
    await save({
      projectId: s2.projectId,
      personId: s2.dev,
      rows: [create(), create()],
    });

    const logs = await logsFor(s2.projectId, s2.dev);
    expect(logs).toHaveLength(2);
    for (const l of logs) {
      expect(await jobsFor(l.id)).toMatchObject([{ job_type: "append" }]);
    }
  });
});
