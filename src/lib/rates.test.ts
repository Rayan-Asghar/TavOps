import { describe, expect, it } from "vitest";
import { resolveRate, type RateRow } from "./rates";

const base: Omit<RateRow, "id" | "effectiveFrom" | "effectiveTo"> = {
  internalCostPerHour: "12.50",
  billableRatePerHour: "50.00",
  currency: "USD",
};

function rate(
  id: string,
  from: string,
  to: string | null = null,
  over: Partial<RateRow> = {},
): RateRow {
  return {
    ...base,
    id,
    effectiveFrom: new Date(from),
    effectiveTo: to === null ? null : new Date(to),
    ...over,
  };
}

const on = (d: string) => new Date(`${d}T12:00:00Z`);

describe("resolveRate", () => {
  it("resolves an open-ended rate", () => {
    const r = resolveRate([rate("a", "2026-01-01T00:00:00Z")], on("2026-07-04"));
    expect(r).toMatchObject({ basis: "rated", rateId: "a" });
  });

  it("includes the day the rate starts", () => {
    const r = resolveRate([rate("a", "2026-07-01T00:00:00Z")], on("2026-07-01"));
    expect(r.basis).toBe("rated");
  });

  it("EXCLUDES the day the rate ends — the half-open boundary", () => {
    // The case most likely to be got wrong, and the one that decides whether a
    // handover day is double-counted or dropped.
    const old = rate("old", "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z");
    const next = rate("new", "2026-07-01T00:00:00Z");

    expect(resolveRate([old, next], on("2026-06-30"))).toMatchObject({
      rateId: "old",
    });
    expect(resolveRate([old, next], on("2026-07-01"))).toMatchObject({
      rateId: "new",
    });
  });

  it("does not let a raise restate the work that came before it", () => {
    const before = rate("before", "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z", {
      internalCostPerHour: "10.00",
    });
    const after = rate("after", "2026-07-01T00:00:00Z", null, {
      internalCostPerHour: "20.00",
    });

    expect(resolveRate([before, after], on("2026-06-15"))).toMatchObject({
      internalCostPerHour: "10.00",
    });
  });

  it("reports a gap between two rates as unrated, not as the nearest rate", () => {
    const first = rate("a", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z");
    const second = rate("b", "2026-06-01T00:00:00Z");

    expect(resolveRate([first, second], on("2026-04-15"))).toEqual({
      basis: "unrated",
    });
  });

  it("is unrated when the person has no rate at all", () => {
    expect(resolveRate([], on("2026-07-04"))).toEqual({ basis: "unrated" });
  });

  it("is unrated before the earliest rate begins", () => {
    expect(
      resolveRate([rate("a", "2026-07-01T00:00:00Z")], on("2026-06-30")),
    ).toEqual({ basis: "unrated" });
  });

  it("refuses overlapping rates instead of picking one", () => {
    // Never "the newest wins": that makes cost depend on insertion order and
    // produces a margin nobody can reproduce.
    const a = rate("a", "2026-01-01T00:00:00Z");
    const b = rate("b", "2026-02-01T00:00:00Z");

    const r = resolveRate([a, b], on("2026-07-04"));
    expect(r).toEqual({ basis: "ambiguous", rateIds: ["a", "b"] });
  });

  it("carries a null rate card through rather than defaulting it to zero", () => {
    const r = resolveRate(
      [rate("a", "2026-01-01T00:00:00Z", null, { billableRatePerHour: null })],
      on("2026-07-04"),
    );
    expect(r).toMatchObject({
      basis: "rated",
      internalCostPerHour: "12.50",
      billableRatePerHour: null,
    });
  });

  it("compares on the UTC day, either side of midnight", () => {
    // The same argument billing-lock.test.ts makes for the inclusive
    // convention: a timestamp late on the boundary day must not fall out of
    // the window it belongs to.
    const r = rate("a", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z");

    expect(resolveRate([r], new Date("2026-07-01T00:30:00Z")).basis).toBe("rated");
    expect(resolveRate([r], new Date("2026-07-31T23:30:00Z")).basis).toBe("rated");
    expect(resolveRate([r], new Date("2026-08-01T00:30:00Z")).basis).toBe(
      "unrated",
    );
  });

  it("keeps the currency the rate was recorded in", () => {
    const r = resolveRate(
      [rate("a", "2026-01-01T00:00:00Z", null, { currency: "PKR" })],
      on("2026-07-04"),
    );
    expect(r).toMatchObject({ currency: "PKR" });
  });
});
