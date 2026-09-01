import { describe, expect, it } from "vitest";
import { isInvoiced } from "./billing-lock";

const on = (d: string) => new Date(`${d}T12:00:00.000Z`);

describe("isInvoiced", () => {
  it("locks nothing when no invoice has been raised", () => {
    expect(isInvoiced(on("2026-01-01"), null)).toBe(false);
  });

  it("locks work before the invoiced date", () => {
    expect(isInvoiced(on("2026-08-15"), "2026-08-31")).toBe(true);
  });

  it("locks work ON the invoiced date, because through means inclusive", () => {
    expect(isInvoiced(on("2026-08-31"), "2026-08-31")).toBe(true);
  });

  it("leaves the day after the invoiced date editable", () => {
    expect(isInvoiced(on("2026-09-01"), "2026-08-31")).toBe(false);
  });

  it("compares by calendar day, not by instant", () => {
    // 23:30 UTC on the invoiced day is still that day and stays locked.
    expect(
      isInvoiced(new Date("2026-08-31T23:30:00.000Z"), "2026-08-31"),
    ).toBe(true);
    // 00:30 UTC the next day is not.
    expect(
      isInvoiced(new Date("2026-09-01T00:30:00.000Z"), "2026-08-31"),
    ).toBe(false);
  });

  it("orders string dates correctly across month and year ends", () => {
    expect(isInvoiced(on("2025-12-31"), "2026-01-01")).toBe(true);
    expect(isInvoiced(on("2026-01-02"), "2026-01-01")).toBe(false);
  });
});
