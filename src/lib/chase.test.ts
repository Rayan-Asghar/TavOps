import { describe, expect, it } from "vitest";
import { proposalStatus } from "@/db/schema";
import {
  CHASE_AFTER_DAYS,
  CHASE_LIMIT,
  chaseClockFrom,
  chaseDueAt,
  chaseState,
  type ProposalStatus,
} from "@/lib/chase";
import { addBusinessHours, HOURS_PER_DAY } from "@/lib/business-time";

/** Inside the 13:00-21:00 UTC shift, so nothing is normalised out from under us. */
const mid = (iso: string) => new Date(`${iso}T15:00:00.000Z`);
// 2026-09-07 is a Monday.
const MON = mid("2026-09-07");

describe("CHASE_AFTER_DAYS", () => {
  it("covers every proposal status", () => {
    // Exhaustive over the enum, so a new status must be given a clock rather
    // than silently inheriting undefined and never being chased.
    for (const s of proposalStatus.enumValues as readonly ProposalStatus[]) {
      expect(CHASE_AFTER_DAYS).toHaveProperty(s);
    }
  });

  it("never chases a decided proposal", () => {
    expect(CHASE_AFTER_DAYS.won).toBeNull();
    expect(CHASE_AFTER_DAYS.lost).toBeNull();
  });

  it("chases a viewed bid sooner than an unopened one", () => {
    // They opened it and said nothing. Silence after a read is a signal;
    // silence after nothing is just Tuesday.
    expect(CHASE_AFTER_DAYS.viewed!).toBeLessThan(CHASE_AFTER_DAYS.sent!);
  });
});

describe("chaseDueAt", () => {
  it("runs the clock from the bid when nothing has been chased", () => {
    expect(chaseClockFrom({ status: "sent", sentAt: MON, lastChasedAt: null })).toEqual(MON);
  });

  it("runs the clock from the last chase once there is one", () => {
    const chased = mid("2026-09-09");
    expect(
      chaseClockFrom({ status: "sent", sentAt: MON, lastChasedAt: chased }),
    ).toEqual(chased);
  });

  it("is null for a decided proposal", () => {
    for (const status of ["won", "lost"] as const) {
      expect(chaseDueAt({ status, sentAt: MON, lastChasedAt: null })).toBeNull();
    }
  });

  it("is null once the chase limit is reached", () => {
    expect(
      chaseDueAt({ status: "sent", sentAt: MON, lastChasedAt: null, chaseCount: CHASE_LIMIT }),
    ).toBeNull();
  });

  it("counts in business hours, so it lands the expected number of shifts later", () => {
    const due = chaseDueAt({ status: "sent", sentAt: MON, lastChasedAt: null })!;
    expect(due).toEqual(addBusinessHours(MON, CHASE_AFTER_DAYS.sent! * HOURS_PER_DAY));
  });
});

describe("chaseState", () => {
  it("does not make a Friday-evening bid cold over the weekend", () => {
    // 2026-09-11 is a Friday. 20:00Z is the last hour of that shift.
    const friday = new Date("2026-09-11T20:00:00.000Z");
    const sunday = new Date("2026-09-13T20:00:00.000Z");
    const state = chaseState({ status: "sent", sentAt: friday, lastChasedAt: null }, sunday);
    // The weekend contributes no business hours at all.
    expect(state.coldHours).toBeLessThan(HOURS_PER_DAY);
    expect(state.due).toBe(false);
  });

  it("comes due after the status's own number of working days", () => {
    const sentAt = MON;
    const input = { status: "sent" as const, sentAt, lastChasedAt: null };
    const justBefore = addBusinessHours(sentAt, CHASE_AFTER_DAYS.sent! * HOURS_PER_DAY - 1);
    const atDue = chaseDueAt(input)!;
    expect(chaseState(input, justBefore).due).toBe(false);
    expect(chaseState(input, atDue).due).toBe(true);
  });

  it("never marks a won or lost proposal due, however old", () => {
    const ancient = mid("2020-01-06");
    for (const status of ["won", "lost"] as const) {
      const s = chaseState({ status, sentAt: ancient, lastChasedAt: null }, MON);
      expect(s.due).toBe(false);
      expect(s.dueAt).toBeNull();
      expect(s.exhausted).toBe(false);
    }
  });

  it("stops asking at the limit and says to close it out instead", () => {
    const s = chaseState(
      { status: "sent", sentAt: mid("2026-01-05"), lastChasedAt: null, chaseCount: CHASE_LIMIT },
      MON,
    );
    // Not due — asking a fifth time is not the next action — but not silently
    // dropped either, which is the failure mode a chase queue dies of.
    expect(s.due).toBe(false);
    expect(s.exhausted).toBe(true);
    expect(s.reason).toMatch(/close it out/i);
  });

  it("resets the clock when the rep chases, so one chase buys a full window", () => {
    const sentAt = mid("2026-09-07");
    const now = addBusinessHours(sentAt, CHASE_AFTER_DAYS.sent! * HOURS_PER_DAY + 1);
    expect(chaseState({ status: "sent", sentAt, lastChasedAt: null }, now).due).toBe(true);
    expect(
      chaseState({ status: "sent", sentAt, lastChasedAt: now, chaseCount: 1 }, now).due,
    ).toBe(false);
  });

  it("describes the silence in terms of the status it is in", () => {
    // A "responded" row saying "no word since it was sent" contradicts the
    // badge beside it. The queue must not argue with itself.
    const old = mid("2026-01-05");
    const responded = chaseState(
      { status: "responded", sentAt: old, lastChasedAt: null },
      MON,
    );
    expect(responded.due).toBe(true);
    expect(responded.reason).not.toMatch(/since it was sent/i);
    expect(responded.reason).toMatch(/replied/i);

    const sent = chaseState({ status: "sent", sentAt: old, lastChasedAt: null }, MON);
    expect(sent.reason).toMatch(/since it was sent/i);
  });

  it("takes no caller-supplied due date", () => {
    /* The guarantee 0011 was about: the only inputs are facts already recorded
       (a status, a bid date, a chase that happened) plus the clock. If this
       assertion ever needs relaxing, the feature has turned back into the one
       that was deleted for asking a rep to plan their own follow-ups. */
    expect(chaseDueAt.length).toBe(1);
    const keys = Object.keys({ status: "sent", sentAt: MON, lastChasedAt: null, chaseCount: 0 });
    expect(keys).not.toContain("dueAt");
    expect(keys).not.toContain("followUpDueAt");
  });
});
