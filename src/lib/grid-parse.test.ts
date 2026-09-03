import { describe, expect, it } from "vitest";
import {
  parseHours,
  parseGridDate,
  formatHours,
  formatGridDate,
} from "./grid-parse";

describe("parseHours", () => {
  it("takes plain numbers", () => {
    expect(parseHours("8")).toEqual({ ok: true, value: 8 });
    expect(parseHours(" 6.25 ")).toEqual({ ok: true, value: 6.25 });
    expect(parseHours(".5")).toEqual({ ok: true, value: 0.5 });
  });

  it("refuses clock notation rather than reading 8:30 as 8.30", () => {
    // Twelve minutes an entry, silently, on every row that used it.
    expect(parseHours("8:30")).toMatchObject({ ok: false });
    expect((parseHours("8:30") as { error: string }).error).toMatch(/8\.5/);
  });

  it("holds the same bounds the server does", () => {
    expect(parseHours("0")).toMatchObject({ ok: false });
    expect(parseHours("24.5")).toMatchObject({ ok: false });
    expect(parseHours("24")).toEqual({ ok: true, value: 24 });
  });

  it("refuses text and empties", () => {
    expect(parseHours("")).toMatchObject({ ok: false });
    expect(parseHours("half a day")).toMatchObject({ ok: false });
  });
});

describe("parseGridDate", () => {
  it("takes ISO", () => {
    expect(parseGridDate("2026-08-01")).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("takes the format the sheet writes, so a copied block pastes back", () => {
    expect(parseGridDate("Sat, 01 Aug 2026")).toEqual({
      ok: true,
      value: "2026-08-01",
    });
    expect(parseGridDate("1 Aug 2026")).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("refuses a slashed date as ambiguous rather than guessing", () => {
    const r = parseGridDate("01/08/2026");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/ambiguous/);
  });

  it("refuses a day that is not on the calendar", () => {
    // Date would roll this into 1 July without complaint.
    expect(parseGridDate("2026-06-31")).toMatchObject({ ok: false });
    expect(parseGridDate("2026-13-01")).toMatchObject({ ok: false });
  });

  it("round-trips through the sheet's format in UTC", () => {
    expect(formatGridDate("2026-08-01")).toBe("Sat, 01 Aug 2026");
    expect(parseGridDate(formatGridDate("2026-12-31"))).toEqual({
      ok: true,
      value: "2026-12-31",
    });
  });
});

describe("formatHours", () => {
  it("always shows two decimals so a column lines up", () => {
    expect(formatHours("2.5")).toBe("2.50");
    expect(formatHours(8)).toBe("8.00");
  });
});
