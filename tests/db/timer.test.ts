import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { owner, resetDb, makeUser, makeProject, addMember, makeTask } from "./harness";

/** Same three mocks, and for the same reasons, as work-log-actions.test.ts. */
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

const { startTimer, finishTimer, adjustTimer } = await import("@/server/timer");

const fd = (o: Record<string, string | number>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, String(v));
  return f;
};

async function scenario() {
  const dev = await makeUser({ role: "developer", name: "Ahmed" });
  const projectId = await makeProject({ code: "ACME" });
  await addMember(projectId, dev, "developer");
  const taskId = await makeTask({ projectId, assigneeId: dev });
  state.actor = { id: dev, globalRole: "developer" };
  return { dev, projectId, taskId };
}

const sessions = async (userId: string) =>
  (await owner`
    SELECT id, status, accumulated_seconds, work_log_id
      FROM time_sessions WHERE user_id = ${userId} ORDER BY started_at`) as unknown as {
    id: string;
    status: string;
    accumulated_seconds: number;
    work_log_id: string | null;
  }[];

beforeEach(async () => {
  await resetDb();
  state.actor = null;
});
afterAll(() => owner.end());

describe("finishing a timer", () => {
  it("produces a work log with its v1 revision, and links the session to it", async () => {
    // Nothing asserted this before: the timer's whole purpose is that it ends
    // as an entry, and the grid now shows the result.
    const { dev, taskId } = await scenario();
    await startTimer(fd({ taskId }));

    const [session] = await sessions(dev);
    await owner`
      UPDATE time_sessions SET accumulated_seconds = 5400, resumed_at = NULL,
             status = 'paused' WHERE id = ${session.id}`;

    const result = await finishTimer(
      { },
      fd({ sessionId: session.id, note: "Built the thing.", resultingStatus: "in_review" }),
    );
    expect(result.ok).toBe(true);

    const [after] = await sessions(dev);
    expect(after.status).toBe("completed");
    expect(after.work_log_id).not.toBeNull();

    const [log] = (await owner`
      SELECT hours, internal_notes FROM work_logs WHERE id = ${after.work_log_id}`) as unknown as {
      hours: string;
      internal_notes: string;
    }[];
    // 5400s is an hour and a half, rounded to the nearest minute.
    expect(log.hours).toBe("1.50");
    expect(log.internal_notes).toBe("Built the thing.");

    const revisions = await owner`
      SELECT version FROM worklog_revisions WHERE work_log_id = ${after.work_log_id}`;
    expect(revisions).toHaveLength(1);
  });
});

describe("adjustTimer", () => {
  it("refuses a session that has already been logged", async () => {
    // Without the status guard this flipped a completed session back to
    // `paused`; finishing it again wrote a SECOND work log and overwrote
    // work_log_id, orphaning the first. Two rows, one session's work.
    const { dev, taskId } = await scenario();
    await startTimer(fd({ taskId }));
    const [session] = await sessions(dev);
    await owner`
      UPDATE time_sessions SET accumulated_seconds = 3600, resumed_at = NULL,
             status = 'paused' WHERE id = ${session.id}`;
    await finishTimer({}, fd({ sessionId: session.id, note: "Done.", resultingStatus: "done" }));

    const result = await adjustTimer(
      {},
      fd({ sessionId: session.id, minutes: 30, reason: "Forgot to stop it." }),
    );

    expect(result.error).toMatch(/already been logged/);
    const [after] = await sessions(dev);
    expect(after.status).toBe("completed");

    const logs = await owner`SELECT id FROM work_logs WHERE project_id IS NOT NULL`;
    expect(logs).toHaveLength(1);
  });

  it("still corrects a running session", async () => {
    const { dev, taskId } = await scenario();
    await startTimer(fd({ taskId }));
    const [session] = await sessions(dev);

    const result = await adjustTimer(
      {},
      fd({ sessionId: session.id, minutes: 45, reason: "Left it running over lunch." }),
    );

    expect(result.ok).toBe(true);
    const [after] = await sessions(dev);
    expect(after.status).toBe("paused");
    expect(after.accumulated_seconds).toBe(2700);
  });
});

describe("one open timer per person", () => {
  it("is enforced by the database, not only by the check in startTimer", async () => {
    // `startTimer` reads then writes, so two concurrent starts both pass its
    // check. The partial unique index is what actually holds the invariant up.
    const { dev, projectId, taskId } = await scenario();
    await startTimer(fd({ taskId }));

    await expect(
      owner`
        INSERT INTO time_sessions (task_id, project_id, user_id, status)
        VALUES (${taskId}, ${projectId}, ${dev}, 'running')`,
    ).rejects.toThrow(/time_sessions_one_open_per_user/);
  });

  it("does not restrict how many completed sessions a person accumulates", async () => {
    const { dev, projectId, taskId } = await scenario();
    for (let i = 0; i < 3; i++) {
      await owner`
        INSERT INTO time_sessions (task_id, project_id, user_id, status, ended_at)
        VALUES (${taskId}, ${projectId}, ${dev}, 'completed', now())`;
    }
    expect(await sessions(dev)).toHaveLength(3);
  });
});
