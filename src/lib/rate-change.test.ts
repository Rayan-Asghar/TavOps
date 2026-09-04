import { describe, expect, it } from "vitest";
import { planRateChange, startOfUtcDay } from "./rate-change";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const next = {
  internalCostPerHour: "20.00",
  billableRatePerHour: "60.00",
  currency: "USD",
};

describe("planRateChange", () => {
  it("opens the first rate with nothing to close", () => {
    const plan = planRateChange(null, next, day("2026-09-01"));
    expect(plan).toMatchObject({ ok: true, closePrevious: null });
  });

  it("closes the old row on exactly the day the new one starts", () => {
    // The half-open boundary. A day either way is a silent gap or a silent
    // overlap, and both stop the costing layer producing numbers.
    const current = { id: "old", effectiveFrom: day("2026-01-01") };
    const plan = planRateChange(current, next, day("2026-10-01"));
    if (!plan.ok) throw new Error("expected ok");

    expect(plan.closePrevious).toEqual({
      id: "old",
      effectiveTo: day("2026-10-01"),
    });
    expect(plan.insert.effectiveFrom).toEqual(day("2026-10-01"));
    // Stated as an identity, because this is the property that matters.
    expect(plan.closePrevious!.effectiveTo).toEqual(plan.insert.effectiveFrom);
  });

  it("refuses a change dated before the current rate began", () => {
    const current = { id: "old", effectiveFrom: day("2026-06-01") };
    expect(planRateChange(current, next, day("2026-05-01"))).toEqual({
      ok: false,
      reason: "not-after-current",
    });
  });

  it("refuses a change dated the same day the current rate began", () => {
    // Would leave the old row covering [x, x) — zero days. That is deleting
    // history, not correcting it.
    const current = { id: "old", effectiveFrom: day("2026-06-01") };
    expect(planRateChange(current, next, day("2026-06-01"))).toEqual({
      ok: false,
      reason: "not-after-current",
    });
  });

  it("normalises to the start of the UTC day", () => {
    const current = { id: "old", effectiveFrom: day("2026-01-01") };
    const plan = planRateChange(
      current,
      next,
      new Date("2026-10-01T17:42:11.123Z"),
    );
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.insert.effectiveFrom).toEqual(day("2026-10-01"));
  });

  it("compares on the day, not the instant", () => {
    // 09:00 on the same day the current rate started is still the same day,
    // and must be refused rather than creating a sub-day window.
    const current = {
      id: "old",
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    };
    expect(
      planRateChange(current, next, new Date("2026-06-01T09:00:00Z")).ok,
    ).toBe(false);
  });

  it("carries a null rate card through rather than defaulting it", () => {
    const plan = planRateChange(
      null,
      { ...next, billableRatePerHour: null },
      day("2026-09-01"),
    );
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.insert.billableRatePerHour).toBeNull();
  });
});

describe("startOfUtcDay", () => {
  it("does not shift the day for a late-evening UTC timestamp", () => {
    expect(startOfUtcDay(new Date("2026-09-04T23:59:59Z"))).toEqual(
      day("2026-09-04"),
    );
  });
});
