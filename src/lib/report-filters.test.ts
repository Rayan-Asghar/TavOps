import { describe, expect, it } from "vitest";
import { parseReportFilters, reportFilterParams } from "./report-filters";

describe("parseReportFilters", () => {
  it("reads the two drill-down values", () => {
    expect(parseReportFilters("yes", null)).toMatchObject({ billable: true });
    expect(parseReportFilters("no", null)).toMatchObject({ billable: false });
    expect(parseReportFilters(null, "no")).toMatchObject({ uncostedOnly: true });
  });

  it("treats absent as BOTH, which is not the same as false", () => {
    // `billable: false` would narrow to non-billable work only. Absent has to
    // stay undefined or the unfiltered report silently becomes a filtered one.
    const f = parseReportFilters(null, null);
    expect(f.billable).toBeUndefined();
    expect(f.uncostedOnly).toBe(false);
  });

  it("falls back rather than throwing on a hand-edited URL", () => {
    expect(parseReportFilters("maybe", "sometimes")).toEqual({
      billable: undefined,
      uncostedOnly: false,
    });
  });

  it("round-trips through the query string", () => {
    for (const [b, c] of [
      ["yes", null],
      ["no", null],
      [null, "no"],
      ["yes", "no"],
      [null, null],
    ] as const) {
      const f = parseReportFilters(b, c);
      const again = parseReportFilters(
        reportFilterParams(f).billable ?? null,
        reportFilterParams(f).costed ?? null,
      );
      expect(again).toEqual(f);
    }
  });

  it("emits nothing for the unfiltered case", () => {
    expect(reportFilterParams(parseReportFilters(null, null))).toEqual({});
  });
});
