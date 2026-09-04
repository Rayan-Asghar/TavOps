import { describe, expect, it } from "vitest";
import {
  defaultRange,
  formatRange,
  isCalendarMonth,
  parseRange,
  stepRange,
  toISODate,
} from "./report-range";

const at = (s: string) => new Date(`${s}T12:00:00.000Z`);

describe("defaultRange", () => {
  it("covers the whole calendar month containing the date", () => {
    const r = defaultRange(at("2026-09-14"));
    expect(toISODate(r.from)).toBe("2026-09-01");
    expect(toISODate(r.to)).toBe("2026-09-30");
  });

  it("gets February right in a leap year", () => {
    const r = defaultRange(at("2028-02-10"));
    expect(toISODate(r.to)).toBe("2028-02-29");
  });

  it("gets December right, rolling into the next year", () => {
    const r = defaultRange(at("2026-12-05"));
    expect(toISODate(r.from)).toBe("2026-12-01");
    expect(toISODate(r.to)).toBe("2026-12-31");
  });
});

describe("parseRange", () => {
  it("uses the given dates when both are valid", () => {
    const r = parseRange("2026-08-01", "2026-08-15");
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([
      "2026-08-01",
      "2026-08-15",
    ]);
  });

  it("falls back to the current month rather than erroring on junk", () => {
    const r = parseRange("not-a-date", null, at("2026-09-14"));
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([
      "2026-09-01",
      "2026-09-30",
    ]);
  });

  it("rejects a plausible but malformed date", () => {
    const r = parseRange("2026-8-1", "2026-08-15", at("2026-09-14"));
    expect(toISODate(r.from)).toBe("2026-09-01");
  });

  it("discards both ends when one is unparseable, never half a window", () => {
    const r = parseRange("2026-8-1", "2026-08-15", at("2026-09-14"));
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([
      "2026-09-01",
      "2026-09-30",
    ]);
  });

  it("still honours one end when the other is simply absent", () => {
    const r = parseRange("2026-09-10", null, at("2026-09-14"));
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([
      "2026-09-10",
      "2026-09-30",
    ]);
  });

  it("swaps a reversed range instead of returning nothing", () => {
    const r = parseRange("2026-08-15", "2026-08-01");
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([
      "2026-08-01",
      "2026-08-15",
    ]);
  });

  it("caps a range that would ask for a decade", () => {
    const r = parseRange("2026-01-01", "2036-01-01");
    const days =
      Math.floor((r.to.getTime() - r.from.getTime()) / 86_400_000) + 1;
    expect(days).toBe(400);
  });

  it("keeps a single day as a single day", () => {
    const r = parseRange("2026-08-24", "2026-08-24");
    expect(toISODate(r.from)).toBe(toISODate(r.to));
  });
});

describe("formatRange", () => {
  it("collapses a range inside one month", () => {
    expect(
      formatRange({ from: at("2026-09-01"), to: at("2026-09-30") }),
    ).toBe("1–30 Sep 2026");
  });

  it("spells both ends when the range crosses a month", () => {
    expect(
      formatRange({ from: at("2026-08-24"), to: at("2026-09-04") }),
    ).toBe("24 Aug 2026 – 4 Sep 2026");
  });
});

describe("stepRange", () => {
  const range = (from: string, to: string) => ({
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T00:00:00.000Z`),
  });
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("steps a calendar month by calendar months, not by 31 days", () => {
    // Stepping March back by its own length lands on 29 Jan – 28 Feb and the
    // window never returns to a month boundary again.
    const prev = stepRange(range("2026-03-01", "2026-03-31"), -1);
    expect(iso(prev.from)).toBe("2026-02-01");
    expect(iso(prev.to)).toBe("2026-02-28");
  });

  it("keeps landing on month ends of differing length", () => {
    const next = stepRange(range("2026-01-01", "2026-01-31"), 1);
    expect(iso(next.from)).toBe("2026-02-01");
    expect(iso(next.to)).toBe("2026-02-28");
  });

  it("crosses a year boundary in both directions", () => {
    const back = stepRange(range("2026-01-01", "2026-01-31"), -1);
    expect(iso(back.from)).toBe("2025-12-01");
    expect(iso(back.to)).toBe("2025-12-31");

    const fwd = stepRange(range("2026-12-01", "2026-12-31"), 1);
    expect(iso(fwd.from)).toBe("2027-01-01");
  });

  it("steps an arbitrary window by its exact length", () => {
    const prev = stepRange(range("2026-03-09", "2026-03-15"), -1);
    expect(iso(prev.from)).toBe("2026-03-02");
    expect(iso(prev.to)).toBe("2026-03-08");
  });

  it("round-trips: forward then back returns the original", () => {
    const start = range("2026-03-01", "2026-03-31");
    const there = stepRange(start, 1);
    const back = stepRange(there, -1);
    expect(iso(back.from)).toBe(iso(start.from));
    expect(iso(back.to)).toBe(iso(start.to));
  });

  it("does not mistake a part-month for a calendar month", () => {
    expect(isCalendarMonth(range("2026-03-01", "2026-03-30"))).toBe(false);
    expect(isCalendarMonth(range("2026-03-02", "2026-03-31"))).toBe(false);
    expect(isCalendarMonth(range("2026-03-01", "2026-03-31"))).toBe(true);
  });
});
