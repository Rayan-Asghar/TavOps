import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { owner, resetDb } from "./harness";

/**
 * The in-app scheduler, against a real database.
 *
 * The claim is guarded by a Postgres advisory lock and re-checks due-ness
 * inside it. Neither of those is testable without Postgres — an advisory lock
 * is a database feature, and a mocked client would only prove the mock is
 * mutually exclusive with itself. This is the case the whole design exists for:
 * several open browsers must produce ONE run.
 */

// The sweeps themselves are exercised by their own code paths; what is under
// test here is exclusion, so the runners are stubbed to something observable
// and slow enough that two callers genuinely overlap.
const runs = vi.hoisted(() => ({
  sweeps: 0,
  sync: 0,
  digest: 0,
  failSweeps: false,
}));

vi.mock("@/server/sweeps", () => ({
  runAllSweeps: async () => {
    runs.sweeps += 1;
    await new Promise((r) => setTimeout(r, 120));
    if (runs.failSweeps) throw new Error("sweep exploded");
    return { escalated: 0 };
  },
}));
vi.mock("@/server/sync-worker", () => ({
  runSyncWorker: async () => {
    runs.sync += 1;
    return { claimed: 0 };
  },
}));
vi.mock("@/server/digest", () => ({
  buildDigest: async () => ({ projects: [], stuckBlockers: [] }),
  renderDigest: () => "digest",
}));
vi.mock("@/server/webhooks", () => ({
  deliver: async () => {
    runs.digest += 1;
    return { delivered: 0, failed: 0, configured: 0 };
  },
}));

const { runDueJobs, recordCronRun } = await import("@/server/scheduler");

beforeEach(async () => {
  await resetDb();
  runs.sweeps = 0;
  runs.sync = 0;
  runs.digest = 0;
  runs.failSweeps = false;
  delete process.env.DIGEST_WEBHOOK_URLS;
  process.env.IN_APP_SCHEDULER = "on";
});

afterAll(async () => {
  await owner.end();
});

const noon = new Date("2026-09-04T12:00:00Z");

describe("concurrent heartbeats", () => {
  it("produce exactly ONE sweep run, not one per browser", async () => {
    // Two open laptops beating at the same instant. This is the assertion the
    // feature exists to satisfy.
    const [a, b] = await Promise.all([
      runDueJobs("heartbeat", noon),
      runDueJobs("heartbeat", noon),
    ]);

    expect(runs.sweeps).toBe(1);

    // Exactly one caller claimed it; the other reported nothing.
    const ran = [...a.ran, ...b.ran].filter((j) => j === "sweeps");
    expect(ran).toEqual(["sweeps"]);

    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "sweeps"));
    expect(row.lastStatus).toBe("ok");
    expect(row.runs).toBe(1);
    expect(row.lastSource).toBe("heartbeat");
  });

  it("still produce one run when five beat at once", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => runDueJobs("heartbeat", noon)),
    );
    expect(runs.sweeps).toBe(1);
  });
});

describe("due-ness", () => {
  it("does not run an hourly job again within the hour", async () => {
    await runDueJobs("heartbeat", noon);
    expect(runs.sweeps).toBe(1);

    await runDueJobs("heartbeat", new Date("2026-09-04T12:30:00Z"));
    expect(runs.sweeps).toBe(1);
  });

  it("runs it again once the hour has passed", async () => {
    await runDueJobs("heartbeat", noon);
    await runDueJobs("heartbeat", new Date("2026-09-04T13:00:00Z"));
    expect(runs.sweeps).toBe(2);
  });

  it("holds the digest back when no webhook is configured", async () => {
    // Claiming the day's run and then delivering nothing would mark the digest
    // done and suppress it for the rest of the day.
    await runDueJobs("heartbeat", new Date("2026-09-04T13:30:00Z"));
    expect(runs.digest).toBe(0);

    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "digest"));
    expect(row).toBeUndefined();
  });

  it("sends the digest once configured, and only once that day", async () => {
    process.env.DIGEST_WEBHOOK_URLS = "https://example.invalid/hook";

    await runDueJobs("heartbeat", new Date("2026-09-04T13:30:00Z"));
    expect(runs.digest).toBe(1);

    await runDueJobs("heartbeat", new Date("2026-09-04T20:00:00Z"));
    expect(runs.digest).toBe(1);
  });
});

describe("a host that has both cron and open browsers", () => {
  it("does the work once — cron stamps, the heartbeat then finds nothing due", async () => {
    await recordCronRun("sweeps", "ok", 42);

    const out = await runDueJobs("heartbeat", new Date("2026-09-04T12:00:30Z"));

    expect(runs.sweeps).toBe(0);
    expect(out.ran).not.toContain("sweeps");

    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "sweeps"));
    expect(row.lastSource).toBe("cron");
  });
});

describe("failures", () => {
  it("records the error and does not retry inside the interval", async () => {
    runs.failSweeps = true;

    const out = await runDueJobs("heartbeat", noon);
    expect(out.failed).toContain("sweeps");

    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "sweeps"));
    expect(row.lastStatus).toBe("error");
    expect(row.lastError).toContain("sweep exploded");

    // A job that reliably dies must not be retried by every heartbeat for the
    // next hour, which is why the claim stamps before the work runs.
    const before = runs.sweeps;
    await runDueJobs("heartbeat", new Date("2026-09-04T12:05:00Z"));
    expect(runs.sweeps).toBe(before);
  });
});

describe("the off switch", () => {
  it("runs nothing when IN_APP_SCHEDULER is off", async () => {
    process.env.IN_APP_SCHEDULER = "off";
    const out = await runDueJobs("heartbeat", noon);
    expect(out).toEqual({ ran: [], skipped: [], failed: [] });
    expect(runs.sweeps).toBe(0);
  });
});
