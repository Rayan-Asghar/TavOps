import { describe, expect, it } from "vitest";
import {
  defaultRange,
  formatRange,
  parseRange,
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
