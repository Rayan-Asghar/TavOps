import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { flagFollowUpsDue } from "@/server/sweeps";
import { inboxFor } from "@/server/notifications";
import { chaseDueCount } from "@/server/proposal-queries";
import { chaseDedupeKey } from "@/server/proposal-schemas";
import { CHASE_LIMIT } from "@/lib/chase";
import { makeUser, owner, resetDb } from "./harness";

/**
 * The chase, against a real database.
 *
 * The parts worth exercising here are all database behaviour: the CHECK that
 * ties a lost reason to a lost status, the dedupe index that stops an hourly
 * sweep nagging daily, and the SQL predicate in `proposal-queries` that has to
 * agree with the TypeScript in `lib/chase.ts` — two clocks that could drift
 * apart without anything failing to compile.
 */

const DAY = 24 * 60 * 60 * 1000;

async function makeProposal(opts: {
  ownerId: string;
  status?: string;
  sentAt?: Date;
  lastChasedAt?: Date | null;
  chaseCount?: number;
  title?: string;
}) {
  const id = randomUUID();
  await owner`
    INSERT INTO proposals (id, owner_id, job_title, status, sent_at, last_chased_at, chase_count)
    VALUES (${id}, ${opts.ownerId}, ${opts.title ?? "A job"},
            ${opts.status ?? "sent"}::proposal_status,
            ${opts.sentAt ?? new Date()},
            ${opts.lastChasedAt ?? null},
            ${opts.chaseCount ?? 0})`;
  return id;
}

/** Well past every cutoff, and far enough back that weekends cannot rescue it. */
const LONG_AGO = () => new Date(Date.now() - 40 * DAY);

let rep: string;
let other: string;

beforeEach(async () => {
  await resetDb();
  rep = await makeUser({ role: "sales", name: "Rep" });
  other = await makeUser({ role: "sales", name: "Other rep" });
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("flagFollowUpsDue", () => {
  it("notifies the owner, and nobody else", async () => {
    const id = await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });

    const { flagged } = await flagFollowUpsDue();
    expect(flagged).toBe(1);

    const mine = await inboxFor(rep);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("followup_due");
    expect(mine[0].isActionable).toBe(true);
    // The link is the difference between a queue item and a sentence.
    expect(mine[0].proposalId).toBe(id);
    expect(await inboxFor(other)).toHaveLength(0);
  });

  it("does not file a second row when it runs again", async () => {
    await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await flagFollowUpsDue();
    await flagFollowUpsDue();
    await flagFollowUpsDue();
    // Hourly sweep, one row. This is the dedupe index doing its job; without it
    // the inbox gains a line an hour and stops being read at all.
    expect(await inboxFor(rep)).toHaveLength(1);
  });

  it("never chases a decided proposal, however old", async () => {
    await makeProposal({ ownerId: rep, sentAt: LONG_AGO(), status: "won" });
    await owner`
      INSERT INTO proposals (id, owner_id, job_title, status, sent_at, lost_reason)
      VALUES (${randomUUID()}, ${rep}, 'Lost one', 'lost', ${LONG_AGO()}, 'price')`;

    const { flagged } = await flagFollowUpsDue();
    expect(flagged).toBe(0);
    expect(await inboxFor(rep)).toHaveLength(0);
  });

  it("leaves a fresh proposal alone", async () => {
    await makeProposal({ ownerId: rep, sentAt: new Date() });
    expect((await flagFollowUpsDue()).flagged).toBe(0);
  });

  it("restarts the clock from the last chase", async () => {
    // Sent long ago but chased just now: one chase buys a full window.
    await makeProposal({
      ownerId: rep,
      sentAt: LONG_AGO(),
      lastChasedAt: new Date(),
      chaseCount: 1,
    });
    expect((await flagFollowUpsDue()).flagged).toBe(0);
  });

  it("stops asking once the chase limit is reached", async () => {
    await makeProposal({
      ownerId: rep,
      sentAt: LONG_AGO(),
      chaseCount: CHASE_LIMIT,
    });
    // Not due: a fifth ask is not the next action. The row is surfaced on the
    // page as something to close out instead.
    expect((await flagFollowUpsDue()).flagged).toBe(0);
  });
});

describe("chaseDueCount", () => {
  it("counts only this rep's own overdue proposals", async () => {
    await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await makeProposal({ ownerId: other, sentAt: LONG_AGO() });
    await makeProposal({ ownerId: rep, sentAt: new Date() });

    expect(await chaseDueCount(rep)).toBe(2);
    expect(await chaseDueCount(other)).toBe(1);
  });

  it("agrees with the sweep about which rows are due", async () => {
    /* The SQL predicate and lib/chase.ts are two implementations of one rule.
       They are allowed to disagree only in the safe direction: SQL may over-
       select and let chaseState reject, never the reverse. */
    for (const days of [0, 1, 2, 3, 4, 10, 40]) {
      await resetDb();
      rep = await makeUser({ role: "sales" });
      await makeProposal({ ownerId: rep, sentAt: new Date(Date.now() - days * DAY) });
      const counted = await chaseDueCount(rep);
      const { flagged } = await flagFollowUpsDue();
      expect(flagged).toBeLessThanOrEqual(counted);
    }
  });
});

describe("the lost-reason constraint", () => {
  it("refuses a lost proposal with no reason", async () => {
    await expect(
      owner`
        INSERT INTO proposals (id, owner_id, job_title, status, sent_at)
        VALUES (${randomUUID()}, ${rep}, 'No reason', 'lost', now())`,
    ).rejects.toThrow(/proposals_lost_reason_only_when_lost/);
  });

  it("refuses a reason on a proposal that is not lost", async () => {
    // The half that matters most: a revived deal keeping its reason would
    // corrupt every count of why we lose.
    await expect(
      owner`
        INSERT INTO proposals (id, owner_id, job_title, status, sent_at, lost_reason)
        VALUES (${randomUUID()}, ${rep}, 'Alive', 'sent', now(), 'price')`,
    ).rejects.toThrow(/proposals_lost_reason_only_when_lost/);
  });

  it("refuses a negative chase count", async () => {
    await expect(
      owner`
        INSERT INTO proposals (id, owner_id, job_title, sent_at, chase_count)
        VALUES (${randomUUID()}, ${rep}, 'Negative', now(), -1)`,
    ).rejects.toThrow(/proposals_chase_count_nonneg/);
  });
});

describe("the notification link", () => {
  it("goes away with the proposal it belongs to", async () => {
    const id = await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await flagFollowUpsDue();
    expect(await inboxFor(rep)).toHaveLength(1);

    await owner`DELETE FROM proposals WHERE id = ${id}`;
    // ON DELETE CASCADE: an inbox row pointing at nothing is a dead link.
    expect(await inboxFor(rep)).toHaveLength(0);
  });

  it("is shadowed by a stale row on the same key, which is why 0021 deletes them", async () => {
    /* The bug this documents cost an afternoon. The follow-up feature deleted
       in 0011 used this same kind and this same `followup:<id>` key, and its
       rows were never resolved. `notify` upserts on (user_id, dedupe_key) and
       on conflict only clears a snooze -- it does not rewrite the title, the
       body or the proposal_id. So a surviving old row permanently shadows the
       new one: the sweep reports flagging it and writes nothing, and the inbox
       shows an unclickable sentence from a feature that no longer exists.

       Migration 0021 deletes those rows for exactly this reason. If that DELETE
       is ever removed as tidying, this test is the explanation. */
    const id = await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await owner`
      INSERT INTO notifications (id, user_id, kind, title, dedupe_key, is_actionable)
      VALUES (${randomUUID()}, ${rep}, 'followup_due', 'Ghost from 0011',
              ${chaseDedupeKey(id)}, true)`;

    const { flagged } = await flagFollowUpsDue();
    expect(flagged).toBe(1);

    const inbox = await inboxFor(rep);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].title).toBe("Ghost from 0011");
    expect(inbox[0].proposalId).toBeNull();
  });

  it("uses one dedupe key per proposal", async () => {
    const a = await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    const b = await makeProposal({ ownerId: rep, sentAt: LONG_AGO() });
    await flagFollowUpsDue();
    const keys = (await inboxFor(rep)).map((n) => n.dedupeKey).sort();
    expect(keys).toEqual([chaseDedupeKey(a), chaseDedupeKey(b)].sort());
  });
});
