import { describe, expect, it } from "vitest";
import { gridTotals } from "./grid-totals";

describe("gridTotals", () => {
  it("is zero-shaped for an empty month rather than blank", () => {
    expect(gridTotals([])).toEqual({
      totalHours: "0.00",
      daysLogged: 0,
      entries: 0,
    });
  });

  it("counts distinct days, not entries", () => {
    const t = gridTotals([
      { workDate: "2026-09-01", hours: "2.00" },
      { workDate: "2026-09-01", hours: "3.00" },
      { workDate: "2026-09-02", hours: "1.00" },
    ]);
    expect(t).toEqual({ totalHours: "6.00", daysLogged: 2, entries: 3 });
  });

  it("does not drift the way repeated float addition does", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; summing in hundredths is
    // what keeps a long column of small entries exact.
    const rows = Array.from({ length: 10 }, () => ({
      workDate: "2026-09-01",
      hours: "0.10",
    }));
    expect(gridTotals(rows).totalHours).toBe("1.00");
  });

  it("keeps two decimals for a whole number of hours", () => {
    expect(gridTotals([{ workDate: "2026-09-01", hours: "8" }]).totalHours).toBe(
      "8.00",
    );
  });
});
