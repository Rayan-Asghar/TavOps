import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser, owner, resetDb } from "./harness";

/**
 * The proposal write path, against a real database.
 *
 * Same shape as `work-log-actions.test.ts`, and mocked for the same reason: a
 * `"use server"` action reaches for request scope a fixture test has none of.
 * `requireActor` calls `auth()` and `revalidatePath` throws outside a request
 * store. Nothing below the actions is mocked — the database, the CHECK
 * constraints and the audit trail are all real.
 */

const state = vi.hoisted(() => ({
  actor: null as { id: string; globalRole: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getActor: async () => state.actor,
  requireActor: async () => {
    if (!state.actor) throw new Error("Not signed in.");
    return state.actor;
  },
}));

const { advanceProposal, markChased } = await import("@/server/proposals");

let rep: string;

async function makeProposal(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  await owner`
    INSERT INTO proposals (id, owner_id, job_title, sent_at)
    VALUES (${id}, ${rep}, 'A job', now() - interval '40 days')`;
  if (Object.keys(overrides).length) {
    await owner`UPDATE proposals SET ${owner(overrides)} WHERE id = ${id}`;
  }
  return id;
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(async () => {
  await resetDb();
  rep = await makeUser({ role: "sales", name: "Rep" });
  state.actor = { id: rep, globalRole: "sales" };
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("losing a deal", () => {
  it("clears the won value, so the Value column stops showing it", async () => {
    const id = await makeProposal({ status: "won", won_value: "4200.00" });

    const res = await advanceProposal(
      {},
      form({ proposalId: id, status: "lost", lostReason: "client_cancelled" }),
    );
    expect(res.error, res.error).toBeUndefined();

    const [row] = await owner`
      SELECT status, won_value, lost_reason FROM proposals WHERE id = ${id}`;
    expect(row.status).toBe("lost");
    expect(row.lost_reason).toBe("client_cancelled");
    // A row badged Lost that still shows $4,200 is a small lie in the place a
    // rep looks first.
    expect(row.won_value).toBeNull();
  });

  it("refuses a loss with no reason, naming the field", async () => {
    const id = await makeProposal();
    const res = await advanceProposal({}, form({ proposalId: id, status: "lost" }));
    expect(res.fieldErrors?.lostReason).toBeTruthy();
    const [row] = await owner`SELECT status FROM proposals WHERE id = ${id}`;
    expect(row.status).toBe("sent");
  });

  it("clears the reason when a lost deal comes back", async () => {
    const id = await makeProposal();
    await advanceProposal(
      {},
      form({ proposalId: id, status: "lost", lostReason: "price", lostNote: "Too dear" }),
    );
    const res = await advanceProposal({}, form({ proposalId: id, status: "responded" }));
    expect(res.error, res.error).toBeUndefined();

    // The database CHECK enforces this too; a stale reason on a revived deal
    // would corrupt every count of why we lose.
    const [row] = await owner`
      SELECT status, lost_reason, lost_note FROM proposals WHERE id = ${id}`;
    expect(row.status).toBe("responded");
    expect(row.lost_reason).toBeNull();
    expect(row.lost_note).toBeNull();
  });
});

describe("advancing is audited", () => {
  it("records who changed the status and what it was before", async () => {
    const id = await makeProposal();
    await advanceProposal(
      {},
      form({ proposalId: id, status: "lost", lostReason: "no_response" }),
    );

    const [entry] = await owner`
      SELECT actor_id, action, before, after FROM audit_log
       WHERE entity_type = 'proposal' AND entity_id = ${id}`;
    // This writer was the only one in src/server changing a row without
    // recording who did it. A lost reason is disputed months later.
    expect(entry.action).toBe("proposal.advance");
    expect(entry.actor_id).toBe(rep);
    expect(entry.before.status).toBe("sent");
    expect(entry.after.lostReason).toBe("no_response");
  });
});

describe("marking a chase", () => {
  it("increments the count and restarts the clock", async () => {
    const id = await makeProposal();
    await markChased({}, form({ proposalId: id }));
    await markChased({}, form({ proposalId: id }));

    const [row] = await owner`
      SELECT chase_count, last_chased_at FROM proposals WHERE id = ${id}`;
    expect(row.chase_count).toBe(2);
    expect(row.last_chased_at).not.toBeNull();
  });

  it("refuses to chase a decided proposal", async () => {
    const id = await makeProposal({ status: "won" });
    const res = await markChased({}, form({ proposalId: id }));
    expect(res.error).toMatch(/already decided/i);
  });

  it("refuses somebody else's proposal", async () => {
    const other = await makeUser({ role: "sales", name: "Other" });
    const id = await makeProposal();
    state.actor = { id: other, globalRole: "sales" };

    const res = await markChased({}, form({ proposalId: id }));
    expect(res.error).toMatch(/not your proposal/i);
    const [row] = await owner`SELECT chase_count FROM proposals WHERE id = ${id}`;
    expect(row.chase_count).toBe(0);
  });
});
