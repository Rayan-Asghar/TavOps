import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  addBusinessHours,
  businessDaysBetween,
  businessHoursBetween,
  HOURS_PER_DAY,
} from "./business-time";

/**
 * The shift is 18:00–02:00 PKT, which is 13:00–21:00 UTC and never crosses a
 * UTC midnight. Every expectation here is written in UTC and annotated with the
 * Pakistani local time, because the local time is what anyone reasoning about
 * these numbers actually pictures.
 */

/** 2026-08-24 is a Monday. */
const MON = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 24, h, m));
const TUE = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 25, h, m));
const FRI = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 28, h, m));
const SAT = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 29, h, m));
const NEXT_MON = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 31, h, m));

describe("the shift window", () => {
  it("is eight hours long", () => {
    expect(HOURS_PER_DAY).toBe(8);
  });

  it("treats a Friday-night shift as Friday, not Saturday", () => {
    // 20:00 UTC Friday is 01:00 Saturday in Pakistan — the last hour of
    // Friday's shift. It must count as working time, not weekend.
    expect(businessHoursBetween(FRI(19), FRI(20))).toBe(1);
  });
});

describe("addBusinessHours", () => {
  it("adds within a single shift", () => {
    // 14:00 UTC (19:00 PKT) + 4h = 18:00 UTC (23:00 PKT), same shift.
    expect(addBusinessHours(MON(14), 4)).toEqual(MON(18));
  });

  it("rolls over into the next shift rather than running past the end", () => {
    // 20:00 UTC Monday (01:00 Tue PKT) has 1h of shift left. +3h spends that
    // hour, then two more from the start of Tuesday's shift.
    expect(addBusinessHours(MON(20), 3)).toEqual(TUE(15));
  });

  it("clamps a before-shift start forward to the shift opening", () => {
    // 09:00 UTC is 14:00 PKT — four hours before anyone starts.
    expect(addBusinessHours(MON(9), 2)).toEqual(MON(15));
  });

  it("clamps an after-shift start to the next shift", () => {
    // 22:00 UTC Monday is 03:00 Tuesday PKT: the shift has ended.
    expect(addBusinessHours(MON(22), 2)).toEqual(TUE(15));
  });

  it("skips the weekend", () => {
    // 20:00 UTC Friday + 4h: 1h left on Friday, 3h into Monday's shift.
    expect(addBusinessHours(FRI(20), 4)).toEqual(NEXT_MON(16));
  });

  it("moves a weekend timestamp forward to Monday", () => {
    expect(addBusinessHours(SAT(15), 0)).toEqual(NEXT_MON(13));
  });

  it("is the SLA case from the plan: 4h from Friday 20:00 UTC lands Monday", () => {
    const due = addBusinessHours(FRI(20), 4);
    expect(due).toEqual(NEXT_MON(16));
    expect(due.getUTCDay()).toBe(1); // Monday, not Saturday
  });
});

describe("addBusinessHours with a negative amount", () => {
  /**
   * The file's own comment records a real bug here: a naive `remaining > 0`
   * loop silently no-ops on negative input and returns a cutoff in the
   * *future*, which made every in-progress task look stale. These lock the
   * backwards walk in place.
   */
  it("walks backwards inside one shift", () => {
    expect(addBusinessHours(MON(18), -4)).toEqual(MON(14));
  });

  it("never returns a time later than it started", () => {
    const from = MON(15);
    expect(addBusinessHours(from, -HOURS_PER_DAY).getTime()).toBeLessThan(
      from.getTime(),
    );
  });

  it("crosses back over a weekend", () => {
    // 15:00 UTC Monday minus 4h: 2h back to the shift start, then the
    // remaining 2h come off the end of Friday's shift.
    expect(addBusinessHours(NEXT_MON(15), -4)).toEqual(FRI(19));
  });

  it("clamps a weekend timestamp back to Friday's close", () => {
    expect(addBusinessHours(SAT(15), -1)).toEqual(FRI(20));
  });

  it("produces a stale-task cutoff in the past, one full shift back", () => {
    // This is exactly how flagStaleTasks derives its cutoff.
    const cutoff = addBusinessHours(TUE(16), -HOURS_PER_DAY);
    expect(cutoff).toEqual(MON(16));
  });
});

describe("businessHoursBetween", () => {
  it("counts only time inside the shift", () => {
    // Monday 20:00 UTC -> Tuesday 15:00 UTC: 1h left Monday + 2h Tuesday.
    expect(businessHoursBetween(MON(20), TUE(15))).toBe(3);
  });

  it("ignores the overnight gap entirely", () => {
    expect(businessHoursBetween(MON(21), TUE(13))).toBe(0);
  });

  it("ignores the weekend", () => {
    expect(businessHoursBetween(FRI(21), NEXT_MON(13))).toBe(0);
  });

  it("returns zero when the end is not after the start", () => {
    expect(businessHoursBetween(MON(15), MON(15))).toBe(0);
    expect(businessHoursBetween(MON(16), MON(14))).toBe(0);
  });

  it("round-trips against addBusinessHours", () => {
    const start = MON(14);
    const end = addBusinessHours(start, 12);
    expect(businessHoursBetween(start, end)).toBeCloseTo(12, 6);
  });
});

describe("addBusinessDays", () => {
  /**
   * One whole shift from a shift's opening lands on that same shift's close,
   * not on the next opening: 13:00 + 8h is 21:00 the same UTC day. The boundary
   * is returned as-is rather than normalised forward, which keeps it consistent
   * with businessHoursBetween — the two must agree or SLA maths drifts.
   */
  it("advances by whole shifts", () => {
    expect(addBusinessDays(MON(13), 1)).toEqual(MON(21));
    expect(businessHoursBetween(MON(13), MON(21))).toBe(HOURS_PER_DAY);
  });

  it("spills into the next shift once it passes a close", () => {
    // Two shifts on from Monday's opening: all of Monday, then all of Tuesday.
    expect(addBusinessDays(MON(13), 2)).toEqual(TUE(21));
  });

  it("skips the weekend", () => {
    // Friday's opening plus one shift is Friday's close...
    expect(addBusinessDays(FRI(13), 1)).toEqual(FRI(21));
    // ...and anything beyond it jumps clear of the weekend to Monday.
    expect(addBusinessHours(FRI(13), HOURS_PER_DAY + 2)).toEqual(NEXT_MON(15));
  });
});

describe("businessDaysBetween", () => {
  const d = (s: string) => new Date(`${s}T12:00:00.000Z`);

  it("counts a Monday-to-Friday week as five", () => {
    // 2026-08-24 is a Monday.
    expect(businessDaysBetween(d("2026-08-24"), d("2026-08-28"))).toBe(5);
  });

  it("includes both ends", () => {
    expect(businessDaysBetween(d("2026-08-24"), d("2026-08-24"))).toBe(1);
  });

  it("skips the weekend inside a range", () => {
    // Monday to the following Friday is ten working days, not fourteen.
    expect(businessDaysBetween(d("2026-08-24"), d("2026-09-04"))).toBe(10);
  });

  it("is zero across a weekend alone", () => {
    // 2026-08-29 Saturday, 2026-08-30 Sunday.
    expect(businessDaysBetween(d("2026-08-29"), d("2026-08-30"))).toBe(0);
  });

  it("is zero when the range runs backwards", () => {
    expect(businessDaysBetween(d("2026-08-28"), d("2026-08-24"))).toBe(0);
  });

  it("ignores the time of day, counting calendar days", () => {
    expect(
      businessDaysBetween(
        new Date("2026-08-24T23:59:00.000Z"),
        new Date("2026-08-25T00:01:00.000Z"),
      ),
    ).toBe(2);
  });
});
