import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  connectsBalance,
  connectsSpendCents,
  connectsStatus,
  lastReconcile,
} from "@/server/connects-queries";
import { flagLowConnects } from "@/server/sweeps";
import { inboxFor } from "@/server/notifications";
import { connectsAlertKey, CONNECTS_FLOOR } from "@/lib/connects";
import { makeUser, owner, resetDb } from "./harness";

/**
 * The connect ledger, against a real database.
 *
 * Nearly everything worth testing here is a CHECK constraint, and CHECKs are
 * the reason 0023 is hand-written — `drizzle-kit generate` models none of them.
 * A mocked client would happily accept every row this file expects to be
 * refused.
 */

let rep: string;
let dev: string;

async function entry(opts: {
  kind: string;
  delta: number;
  amountCents?: number | null;
  proposalId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  by?: string;
}) {
  const id = randomUUID();
  await owner`
    INSERT INTO connect_ledger (id, kind, delta, amount_cents, proposal_id, note, occurred_at, recorded_by_id)
    VALUES (${id}, ${opts.kind}::connect_entry_kind, ${opts.delta},
            ${opts.amountCents ?? null}, ${opts.proposalId ?? null},
            ${opts.note ?? null}, ${opts.occurredAt ?? new Date()},
            ${opts.by ?? rep})`;
  return id;
}

async function makeProposal() {
  const id = randomUUID();
  await owner`
    INSERT INTO proposals (id, owner_id, job_title, sent_at)
    VALUES (${id}, ${rep}, 'A job', now())`;
  return id;
}

beforeEach(async () => {
  await resetDb();
  rep = await makeUser({ role: "sales", name: "Rep" });
  dev = await makeUser({ role: "developer", name: "Dev" });
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("the balance", () => {
  it("is the signed sum, derived and never cached", async () => {
    await entry({ kind: "purchase", delta: 80, amountCents: 1200 });
    await entry({ kind: "grant", delta: 10 });
    const p = await makeProposal();
    await entry({ kind: "bid", delta: -16, proposalId: p });
    expect(await connectsBalance()).toBe(74);
  });

  it("is zero on an empty ledger, not null", async () => {
    expect(await connectsBalance()).toBe(0);
  });

  it("counts money only from purchases", async () => {
    await entry({ kind: "purchase", delta: 60, amountCents: 900 });
    await entry({ kind: "purchase", delta: 60, amountCents: 900 });
    await entry({ kind: "grant", delta: 10 });
    expect(await connectsSpendCents(30)).toBe(1800);
  });
});

describe("the CHECK constraints", () => {
  it("refuses a bid that adds to the balance", async () => {
    const p = await makeProposal();
    await expect(
      entry({ kind: "bid", delta: 16, proposalId: p }),
    ).rejects.toThrow(/cl_sign_matches_kind/);
  });

  it("refuses a purchase that subtracts", async () => {
    await expect(
      entry({ kind: "purchase", delta: -16, amountCents: 100 }),
    ).rejects.toThrow(/cl_sign_matches_kind/);
  });

  it("refuses money on anything but a purchase", async () => {
    // The anti-attribution rule, made structural: pricing a spend needs a
    // costing basis, and a basis picked for a report is a number somebody
    // will price a hiring decision off.
    await expect(
      entry({ kind: "grant", delta: 10, amountCents: 500 }),
    ).rejects.toThrow(/cl_money_only_on_purchase/);
  });

  it("refuses a purchase with no price", async () => {
    await expect(entry({ kind: "purchase", delta: 60 })).rejects.toThrow(
      /cl_money_only_on_purchase/,
    );
  });

  it("refuses a bid with no proposal", async () => {
    await expect(entry({ kind: "bid", delta: -16 })).rejects.toThrow(
      /cl_bid_needs_proposal/,
    );
  });

  it("refuses a proposal link on a kind where it means nothing", async () => {
    const p = await makeProposal();
    await expect(
      entry({ kind: "grant", delta: 10, proposalId: p }),
    ).rejects.toThrow(/cl_proposal_only_where_meaningful/);
  });

  it("refuses a reconcile with no note", async () => {
    await expect(entry({ kind: "reconcile", delta: 5 })).rejects.toThrow(
      /cl_reconcile_needs_note/,
    );
    await expect(
      entry({ kind: "reconcile", delta: 5, note: "   " }),
    ).rejects.toThrow(/cl_reconcile_needs_note/);
  });

  it("refuses a zero delta", async () => {
    await expect(
      entry({ kind: "reconcile", delta: 0, note: "square" }),
    ).rejects.toThrow(/cl_delta_nonzero/);
  });

  it("allows a reconcile in either direction", async () => {
    await entry({ kind: "reconcile", delta: -8, note: "expired, unrecorded" });
    await entry({ kind: "reconcile", delta: 12, note: "free monthly" });
    expect(await connectsBalance()).toBe(4);
  });

  it("spends a proposal's connects at most once", async () => {
    const p = await makeProposal();
    await entry({ kind: "bid", delta: -16, proposalId: p });
    // A double submit must not quietly spend twice.
    await expect(
      entry({ kind: "bid", delta: -16, proposalId: p }),
    ).rejects.toThrow(/cl_one_bid_per_proposal/);
    // A boost is a different kind, so it is still allowed alongside the bid.
    await entry({ kind: "boost", delta: -8, proposalId: p });
    expect(await connectsBalance()).toBe(-24);
  });

  it("refuses to delete a proposal whose connects were spent", async () => {
    /* RESTRICT rather than SET NULL: erasing the proposal must not rewrite the
       balance, and SET NULL would fire an UPDATE that then violates
       cl_bid_needs_proposal, producing a confusing CHECK error instead of an
       honest foreign-key one. */
    const p = await makeProposal();
    await entry({ kind: "bid", delta: -16, proposalId: p });
    await expect(owner`DELETE FROM proposals WHERE id = ${p}`).rejects.toThrow(
      /connect_ledger/,
    );
  });
});

describe("reconciliation", () => {
  it("records the drift rather than hiding it", async () => {
    await entry({ kind: "purchase", delta: 100, amountCents: 1500 });
    await entry({ kind: "reconcile", delta: -8, note: "Upwork said 92" });
    const last = await lastReconcile();
    expect(last?.drift).toBe(-8);
    expect(last?.note).toBe("Upwork said 92");
    expect(await connectsBalance()).toBe(92);
  });

  it("returns null when nobody has ever reconciled", async () => {
    expect(await lastReconcile()).toBeNull();
  });
});

describe("flagLowConnects", () => {
  it("tells everyone who can buy connects, and nobody else", async () => {
    await entry({ kind: "purchase", delta: 4, amountCents: 100 });
    const res = await flagLowConnects();
    expect(res.level).toBe(2);

    const mine = await inboxFor(rep);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("connects_low");
    // A developer cannot buy connects and is not told about them.
    expect(await inboxFor(dev)).toHaveLength(0);
  });

  it("does not file a second row when it runs again", async () => {
    await entry({ kind: "purchase", delta: 4, amountCents: 100 });
    await flagLowConnects();
    await flagLowConnects();
    await flagLowConnects();
    expect(await inboxFor(rep)).toHaveLength(1);
  });

  it("says nothing while the balance is healthy", async () => {
    await entry({ kind: "purchase", delta: 500, amountCents: 7500 });
    await flagLowConnects();
    expect(await inboxFor(rep)).toHaveLength(0);
  });

  it("resolves the alert when a purchase lifts the balance back", async () => {
    await entry({ kind: "purchase", delta: 4, amountCents: 100 });
    await flagLowConnects();
    expect(await inboxFor(rep)).toHaveLength(1);

    await entry({ kind: "purchase", delta: 200, amountCents: 3000 });
    await flagLowConnects();
    // An emptiable queue is the whole product. A warning that survives the
    // thing it warned about is one people learn to ignore.
    expect(await inboxFor(rep)).toHaveLength(0);
  });

  it("keys the alert on the level, so a moving balance does not spam", async () => {
    await entry({ kind: "purchase", delta: 4, amountCents: 100 });
    await flagLowConnects();
    const p = await makeProposal();
    await entry({ kind: "bid", delta: -1, proposalId: p });
    await flagLowConnects();
    const inbox = await inboxFor(rep);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].dedupeKey).toBe(connectsAlertKey(2));
  });

  it("warns at level 1 before the floor is reached", async () => {
    // Comfortably above the floor, but burning fast enough to run out inside
    // a working week.
    await entry({ kind: "purchase", delta: CONNECTS_FLOOR + 8, amountCents: 400 });
    for (let i = 0; i < 6; i++) {
      const p = await makeProposal();
      await entry({ kind: "bid", delta: -16, proposalId: p });
      await entry({ kind: "purchase", delta: 16, amountCents: 240 });
    }
    const status = await connectsStatus();
    expect(status.runwayDays).not.toBeNull();
  });
});
