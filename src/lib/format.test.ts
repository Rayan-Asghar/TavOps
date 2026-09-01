import { describe, expect, it } from "vitest";
import {
  fmtDate,
  fmtDateFull,
  fmtDateTime,
  fmtDayLabel,
  hrs,
  money,
  pct,
  timeAgo,
} from "./format";

const at = (s: string) => new Date(s);

describe("fmtDate", () => {
  it("formats in UTC", () => {
    expect(fmtDate(at("2026-09-01T12:00:00.000Z"))).toBe("Sep 01");
  });

  it("does not roll the date backwards late in the UTC day", () => {
    // 21:00 UTC is 02:00 PKT — the end of the shift, still the same work day.
    expect(fmtDate(at("2026-09-01T21:00:00.000Z"))).toBe("Sep 01");
  });

  it("does not roll the date forwards early in the UTC day", () => {
    expect(fmtDate(at("2026-09-01T00:30:00.000Z"))).toBe("Sep 01");
  });

  it("renders an em dash for null and undefined", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
  });
});

describe("fmtDateFull", () => {
  it("includes the year", () => {
    expect(fmtDateFull(at("2026-09-01T12:00:00.000Z"))).toBe("Sep 01, 2026");
  });
});

describe("fmtDateTime", () => {
  it("formats date and time in UTC", () => {
    expect(fmtDateTime(at("2026-09-01T21:05:00.000Z"))).toBe(
      "Sep 01, 09:05 PM",
    );
  });

  it("stays on the same date at the end of the UTC day", () => {
    expect(fmtDateTime(at("2026-09-01T23:59:00.000Z"))).toContain("Sep 01");
  });
});

describe("fmtDayLabel", () => {
  it("names the UTC weekday", () => {
    expect(fmtDayLabel(at("2026-09-01T12:00:00.000Z"))).toBe("TUESDAY · SEP 01");
  });

  it("still reports the shift's own day at 02:00 PKT", () => {
    // The old implementation used the server's zone; on a UTC host this is the
    // case that reported the wrong day to a Pakistan-based user.
    expect(fmtDayLabel(at("2026-09-01T21:00:00.000Z"))).toBe(
      "TUESDAY · SEP 01",
    );
  });
});

describe("timeAgo", () => {
  const now = at("2026-09-01T12:00:00.000Z");

  it("says 'just now' under a minute", () => {
    expect(timeAgo(at("2026-09-01T11:59:30.000Z"), now)).toBe("just now");
  });

  it("keeps minute resolution under an hour", () => {
    expect(timeAgo(at("2026-09-01T11:23:00.000Z"), now)).toBe("37 min ago");
  });

  it("switches to hours at an hour", () => {
    expect(timeAgo(at("2026-09-01T11:00:00.000Z"), now)).toBe("1h ago");
  });

  it("switches to days at a day", () => {
    expect(timeAgo(at("2026-08-30T12:00:00.000Z"), now)).toBe("2d ago");
  });

  it("renders an em dash for null", () => {
    expect(timeAgo(null, now)).toBe("—");
  });
});

describe("hrs", () => {
  it("pads to two decimals so columns line up", () => {
    expect(hrs(3)).toBe("3.00");
    expect(hrs(3.5)).toBe("3.50");
  });

  it("takes one decimal when asked", () => {
    expect(hrs(3.25, 1)).toBe("3.3");
  });
});

describe("pct", () => {
  it("rounds to a whole percent", () => {
    expect(pct(0.336)).toBe("34%");
  });

  it("distinguishes null from zero", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("0%");
  });
});

describe("money", () => {
  it("renders whole dollars with separators", () => {
    expect(money(12500)).toBe("$12,500");
  });

  it("distinguishes null from zero", () => {
    expect(money(null)).toBe("—");
    expect(money(0)).toBe("$0");
  });
});
