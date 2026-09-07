import { describe, expect, it } from "vitest";
import {
  connectsAlertKey,
  connectsHealth,
  connectsSpend,
  CONNECTS_FLOOR,
  RUNWAY_DAYS_WARNING,
} from "@/lib/connects";

const health = (balance: number, spentInWindow = 0, windowDays = 10) =>
  connectsHealth({ balance, spentInWindow, windowDays });

describe("connectsHealth", () => {
  it("is level 2 below the floor, and says the thing that is actually true", () => {
    const h = health(CONNECTS_FLOOR - 1);
    expect(h.level).toBe(2);
    // "You cannot place another boosted bid" is a fact; "connects are low" is
    // an opinion, and only one of them tells a rep what has stopped working.
    expect(h.reason).toMatch(/boosted bid/i);
  });

  it("has a distinct message for empty, because it is a different problem", () => {
    expect(health(0).level).toBe(2);
    expect(health(0).reason).toMatch(/no connects left/i);
  });

  it("is level 0 well above the floor with no burn history", () => {
    const h = health(200);
    expect(h.level).toBe(0);
    expect(h.runwayDays).toBeNull();
    expect(h.reason).toMatch(/no recent bids/i);
  });

  it("derives runway from the team's own burn, not a magic number", () => {
    // 100 connects, 50 spent over 10 working days = 5/day = 20 days left.
    const h = health(100, 50, 10);
    expect(h.runwayDays).toBe(20);
    expect(h.level).toBe(0);
  });

  it("warns when the runway is inside a working week", () => {
    // 20 connects, 40 spent over 10 days = 4/day = 5 days left.
    const h = health(20, 40, 10);
    expect(h.level).toBe(1);
    expect(h.runwayDays).toBe(RUNWAY_DAYS_WARNING);
    expect(h.reason).toMatch(/bidding left/i);
  });

  it("lets the floor win over the runway", () => {
    // Plenty of runway by rate, but not enough for one boosted bid.
    const h = health(CONNECTS_FLOOR - 1, 1, 100);
    expect(h.level).toBe(2);
  });

  it("returns null rather than Infinity when nothing has been spent", () => {
    /* The standing rule in this codebase: an unknowable number is null, never
       a plausible-looking one. A runway of Infinity would render as a number
       somebody could plan against. */
    for (const [spent, days] of [
      [0, 10],
      [0, 0],
      [5, 0],
    ] as const) {
      const h = connectsHealth({ balance: 100, spentInWindow: spent, windowDays: days });
      expect(h.runwayDays).toBeNull();
      expect(Number.isFinite(h.runwayDays ?? 0)).toBe(true);
    }
  });

  it("never reports a negative runway on an overdrawn balance", () => {
    const h = connectsHealth({ balance: -5, spentInWindow: 50, windowDays: 10 });
    expect(h.level).toBe(2);
    expect(h.runwayDays).toBe(0);
  });
});

describe("connectsAlertKey", () => {
  it("keys on the level, never the balance", () => {
    // A balance in the key files a fresh inbox row every time it moves by one,
    // which is exactly how a warning turns into noise people mute.
    expect(connectsAlertKey(1)).toBe("connects_low:L1");
    expect(connectsAlertKey(2)).toBe("connects_low:L2");
    expect(connectsAlertKey(2)).not.toMatch(/\d{2,}/);
  });
});

describe("connectsSpend", () => {
  it("formats cents, never floats", () => {
    expect(connectsSpend(1500)).toBe("$15.00");
    expect(connectsSpend(999)).toBe("$9.99");
  });
});
