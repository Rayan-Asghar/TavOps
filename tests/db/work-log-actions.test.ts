import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  owner,
  resetDb,
  makeUser,
  makeProject,
  addMember,
  makeWorkLog,
  makeTask,
  makeConnection,
  setInvoicedThrough,
  revisionsFor,
  auditFor,
  logRow,
  jobsFor,
} from "./harness";

/**
 * Characterisation tests for the work-log write path.
 *
 * These exercise the exported actions rather than their internals on purpose:
 * they were written before `work-log-writes.ts` was extracted, and they are the
 * evidence that the extraction changed no behaviour. Keep them passing across
 * the refactor; if one has to change, the refactor changed something.
 *
 * Three modules are mocked because a `"use server"` action reaches for request
 * scope that a fixture test has none of: `requireActor` calls `auth()`,
 * `revalidatePath` throws outside a request store, and `after()` would run the
 * sync worker against Google. Nothing below the actions is mocked — the
 * database, the revision chain and the outbox are all real.
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

const { logWork, editWorkLog, deleteWorkLog } = await import(
  "@/server/work-logs"
);

/** A developer on their own project, with one entry already logged. */
async function scenario(opts: { invoicedThrough?: string | null } = {}) {
  const userId = await makeUser({ role: "developer", name: "Dev" });
  const projectId = await makeProject({ pmId: null });
  await addMember(projectId, userId, "developer");
  if (opts.invoicedThrough !== undefined) {
    await setInvoicedThrough(projectId, opts.invoicedThrough);
  }
  const log = await makeWorkLog({
    projectId,
    userId,
    hours: "2.50",
    notes: "Did the thing.",
    workDate: "2026-09-10",
  });
  state.actor = { id: userId, globalRole: "developer" };
  return { userId, projectId, log };
}

beforeEach(async () => {
  await resetDb();
  state.actor = null;
});
afterAll(() => owner.end());

describe("editWorkLog", () => {
  it("appends v2 and points the entry at it", async () => {
    const { log } = await scenario();

    await editWorkLog({
      workLogId: log.id,
      hours: 4,
      internalNotes: "Actually took longer.",
      reason: "Miscounted.",
    });

    const revisions = await revisionsFor(log.id);
    expect(revisions.map((r) => r.version)).toEqual([1, 2]);
    expect(revisions[1]).toMatchObject({
      hours: "4.00",
      internal_notes: "Actually took longer.",
      reason: "Miscounted.",
      is_reversal: false,
    });

    // The mirrored columns and the head of the chain must agree.
    const row = await logRow(log.id);
    expect(row.hours).toBe("4.00");
    expect(row.internal_notes).toBe("Actually took longer.");
    expect(row.current_revision_id).not.toBe(log.revisionId);
    expect(row.deleted_at).toBeNull();
  });

  it("writes exactly one audit row, carrying the fields that moved", async () => {
    const { log } = await scenario();

    await editWorkLog({
      workLogId: log.id,
      hours: 4,
      internalNotes: "Actually took longer.",
      reason: "Miscounted.",
    });

    const audit = await auditFor(log.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("work_log.edit");
    expect(audit[0].before).toMatchObject({ hours: "2.50" });
    expect(audit[0].after).toMatchObject({ hours: "4.00", version: 2 });
  });

  it("refuses an edit to work that has already been invoiced", async () => {
    const { log } = await scenario({ invoicedThrough: "2026-09-30" });

    await expect(
      editWorkLog({
        workLogId: log.id,
        hours: 4,
        internalNotes: "Actually took longer.",
        reason: "Miscounted.",
      }),
    ).rejects.toThrow(/already been invoiced/);

    // Nothing partial: no revision, no audit row, no change.
    expect(await revisionsFor(log.id)).toHaveLength(1);
    expect(await auditFor(log.id)).toHaveLength(0);
    expect((await logRow(log.id)).hours).toBe("2.50");
  });

  it("refuses to move an entry OUT of a billed period", async () => {
    // The entry is inside the billed window; the new date is outside it.
    const { log } = await scenario({ invoicedThrough: "2026-09-30" });

    await expect(
      editWorkLog({
        workLogId: log.id,
        hours: 2.5,
        internalNotes: "Did the thing.",
        workDate: "2026-10-05",
        reason: "Wrong day.",
      }),
    ).rejects.toThrow(/already been invoiced/);
  });

  it("refuses to move an entry INTO a billed period", async () => {
    // The entry is outside the billed window; the new date falls inside it.
    const { projectId, userId } = await scenario({
      invoicedThrough: "2026-08-31",
    });
    const later = await makeWorkLog({
      projectId,
      userId,
      hours: "1.00",
      workDate: "2026-09-15",
    });

    await expect(
      editWorkLog({
        workLogId: later.id,
        hours: 1,
        internalNotes: "Did the thing.",
        workDate: "2026-08-20",
        reason: "Wrong day.",
      }),
    ).rejects.toThrow(/already been invoiced/);
  });

  it("reports an entry on an unreachable project as missing, not forbidden", async () => {
    await scenario();
    const stranger = await makeUser({ role: "developer" });
    const otherProject = await makeProject({});
    const theirs = await makeWorkLog({
      projectId: otherProject,
      userId: stranger,
    });

    await expect(
      editWorkLog({
        workLogId: theirs.id,
        hours: 1,
        internalNotes: "Not mine.",
        reason: "Curiosity.",
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("refuses to correct somebody else's entry without worklog.edit", async () => {
    const { projectId } = await scenario();
    const colleague = await makeUser({ role: "developer", name: "Other" });
    await addMember(projectId, colleague, "developer");
    const theirs = await makeWorkLog({ projectId, userId: colleague });

    await expect(
      editWorkLog({
        workLogId: theirs.id,
        hours: 1,
        internalNotes: "Fixing yours.",
        reason: "Looked wrong.",
      }),
      // The raw capability error; safeErrorMessage is what turns this into
      // "You do not have permission to do that." at the form boundary.
    ).rejects.toThrow(/Missing capability: worklog\.edit/);
  });

  it("lets a head correct somebody else's entry", async () => {
    const { projectId, userId } = await scenario();
    const head = await makeUser({ role: "head", name: "Head" });
    const theirs = await makeWorkLog({ projectId, userId, hours: "3.00" });
    state.actor = { id: head, globalRole: "head" };

    await editWorkLog({
      workLogId: theirs.id,
      hours: 1,
      internalNotes: "Corrected.",
      reason: "Double counted.",
    });

    expect((await logRow(theirs.id)).hours).toBe("1.00");
  });

  it("queues exactly one update job, keyed on the new revision", async () => {
    const { projectId, log } = await scenario();
    const connectionId = await makeConnection({ projectId });

    await editWorkLog({
      workLogId: log.id,
      hours: 4,
      internalNotes: "Actually took longer.",
      reason: "Miscounted.",
    });

    const jobs = await jobsFor(log.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_type).toBe("update");
    const revisions = await revisionsFor(log.id);
    expect(jobs[0].idempotency_key).toBe(
      `revision:${(await logRow(log.id)).current_revision_id}:${connectionId}`,
    );
    expect(revisions).toHaveLength(2);
  });

  it("commits with no sheet connection, queueing nothing", async () => {
    const { log } = await scenario();

    await editWorkLog({
      workLogId: log.id,
      hours: 4,
      internalNotes: "Actually took longer.",
      reason: "Miscounted.",
    });

    expect(await jobsFor(log.id)).toHaveLength(0);
    expect((await logRow(log.id)).hours).toBe("4.00");
  });
});

describe("deleteWorkLog", () => {
  it("appends a reversal at zero hours and leaves the row standing", async () => {
    const { log } = await scenario();

    await deleteWorkLog({ workLogId: log.id, reason: "Logged twice." });

    const revisions = await revisionsFor(log.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({ hours: "0.00", is_reversal: true });

    const row = await logRow(log.id);
    expect(row.deleted_at).not.toBeNull();
    // The row survives: the reversal is the record, not a gap.
    expect(row.hours).toBe("2.50");
  });

  it("refuses to remove work that has already been invoiced", async () => {
    const { log } = await scenario({ invoicedThrough: "2026-09-30" });

    await expect(
      deleteWorkLog({ workLogId: log.id, reason: "Logged twice." }),
    ).rejects.toThrow(/already been invoiced/);
    expect((await logRow(log.id)).deleted_at).toBeNull();
  });

  it("refuses a second removal of the same entry", async () => {
    const { log } = await scenario();
    await deleteWorkLog({ workLogId: log.id, reason: "Logged twice." });

    await expect(
      deleteWorkLog({ workLogId: log.id, reason: "Again." }),
    ).rejects.toThrow(/already been removed/);
  });

  it("queues a delete job that blanks rather than removes", async () => {
    const { projectId, log } = await scenario();
    const connectionId = await makeConnection({ projectId });

    await deleteWorkLog({ workLogId: log.id, reason: "Logged twice." });

    const jobs = await jobsFor(log.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_type).toBe("delete");
    expect(jobs[0].idempotency_key).toBe(`delete:${log.id}:${connectionId}`);
  });
});

describe("concurrent corrections", () => {
  it("allocates v2 and v3 rather than colliding on the version index", async () => {
    // Two people correcting one entry at the same moment. `nextVersion` is a
    // read-then-write; without FOR UPDATE on the work_logs row both reads see
    // version 1, both write version 2, and the loser dies on
    // worklog_revisions_version_unique. The row lock serialises them instead.
    const { projectId, log } = await scenario();
    const head = await makeUser({ role: "head", name: "Head" });
    await addMember(projectId, head, "pm");

    const results = await Promise.allSettled([
      editWorkLog({
        workLogId: log.id,
        hours: 3,
        internalNotes: "First correction.",
        reason: "One.",
      }),
      editWorkLog({
        workLogId: log.id,
        hours: 5,
        internalNotes: "Second correction.",
        reason: "Two.",
      }),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);

    const revisions = await revisionsFor(log.id);
    expect(revisions.map((r) => r.version)).toEqual([1, 2, 3]);
    // Last writer wins, and the mirrored row agrees with the head of the chain.
    const row = await logRow(log.id);
    expect(row.hours).toBe(revisions[2].hours);
  });
});

describe("logWork", () => {
  it("records an entry with its v1 revision and an append job", async () => {
    const userId = await makeUser({ role: "developer" });
    const projectId = await makeProject({});
    await addMember(projectId, userId, "developer");
    const taskId = await makeTask({ projectId, assigneeId: userId });
    await makeConnection({ projectId });
    state.actor = { id: userId, globalRole: "developer" };

    const result = await logWork({
      projectId,
      taskId,
      hours: 3.25,
      internalNotes: "Built the thing.",
      resultingStatus: "in_progress",
    });

    const revisions = await revisionsFor(result.entry.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ version: 1, hours: "3.25" });
    expect(await jobsFor(result.entry.id)).toMatchObject([
      { job_type: "append" },
    ]);
  });
});
