import { describe, expect, it } from "vitest";
import {
  elapsedSeconds,
  formatClock,
  formatDuration,
  RUNAWAY_TIMER_HOURS,
  secondsToHours,
} from "./timer-utils";

/**
 * Elapsed time is derived, never ticked. These tests exist because that
 * property is the whole reason a closed laptop or a server restart does not
 * lose somebody's hours — if it ever regresses to a stored counter, this fails.
 */

const NOW = Date.UTC(2026, 7, 24, 18, 0, 0);
const minsAgo = (n: number) => new Date(NOW - n * 60_000);

describe("elapsedSeconds", () => {
  it("adds the live segment to the banked total while running", () => {
    const s = {
      status: "running" as const,
      accumulatedSeconds: 600,
      resumedAt: minsAgo(10),
    };
    expect(elapsedSeconds(s, NOW)).toBe(600 + 600);
  });

  it("returns only the banked total while paused", () => {
    const s = {
      status: "paused" as const,
      accumulatedSeconds: 900,
      // A paused session drops the marker, so there is no live segment.
      resumedAt: null,
    };
    expect(elapsedSeconds(s, NOW)).toBe(900);
  });

  it("ignores a stale resumedAt when the status says paused", () => {
    // Defensive: the marker and the status disagreeing must not invent time.
    const s = {
      status: "paused" as const,
      accumulatedSeconds: 900,
      resumedAt: minsAgo(60),
    };
    expect(elapsedSeconds(s, NOW)).toBe(900);
  });

  it("never goes backwards if resumedAt is somehow in the future", () => {
    const s = {
      status: "running" as const,
      accumulatedSeconds: 300,
      resumedAt: new Date(NOW + 60_000),
    };
    expect(elapsedSeconds(s, NOW)).toBe(300);
  });

  it("accepts an ISO string, as it arrives from a client component", () => {
    const s = {
      status: "running" as const,
      accumulatedSeconds: 0,
      resumedAt: minsAgo(5).toISOString(),
    };
    expect(elapsedSeconds(s, NOW)).toBe(300);
  });

  it("prefers the correction over the measured value once completed", () => {
    const s = {
      status: "completed" as const,
      accumulatedSeconds: 43_200,
      resumedAt: null,
      adjustedSeconds: 3_600,
    };
    expect(elapsedSeconds(s, NOW)).toBe(3_600);
  });

  it("falls back to the measured value when there is no correction", () => {
    const s = {
      status: "completed" as const,
      accumulatedSeconds: 5_400,
      resumedAt: null,
      adjustedSeconds: null,
    };
    expect(elapsedSeconds(s, NOW)).toBe(5_400);
  });

  it("keeps a zero-second correction rather than treating it as absent", () => {
    // `?? ` not `|| ` — correcting a runaway timer to zero is a real action.
    const s = {
      status: "completed" as const,
      accumulatedSeconds: 43_200,
      resumedAt: null,
      adjustedSeconds: 0,
    };
    expect(elapsedSeconds(s, NOW)).toBe(0);
  });
});

describe("secondsToHours", () => {
  it("rounds to the nearest minute so hours are not absurdly precise", () => {
    // 5h 47m would otherwise be 5.783333...
    expect(secondsToHours(5 * 3600 + 47 * 60)).toBeCloseTo(5.783333, 5);
  });

  it("is exact on whole hours", () => {
    expect(secondsToHours(3 * 3600)).toBe(3);
  });

  it("rounds a part-minute up to the nearest minute", () => {
    expect(secondsToHours(90)).toBeCloseTo(2 / 60, 6);
  });

  it("returns zero for a sub-30-second session", () => {
    // finishTimer refuses these and points at the manual form.
    expect(secondsToHours(20)).toBe(0);
  });
});

describe("formatting", () => {
  it("drops to minutes under an hour", () => {
    expect(formatDuration(47 * 60)).toBe("47m");
  });

  it("drops to seconds under a minute", () => {
    expect(formatDuration(40)).toBe("40s");
  });

  it("pads the minutes in the hour form", () => {
    expect(formatDuration(5 * 3600 + 7 * 60)).toBe("5h 07m");
  });

  it("renders a zero-padded stopwatch", () => {
    expect(formatClock(3600 + 2 * 60 + 3)).toBe("01:02:03");
  });

  it("clamps negatives rather than rendering a minus sign", () => {
    expect(formatClock(-5)).toBe("00:00:00");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("RUNAWAY_TIMER_HOURS", () => {
  it("is longer than any plausible 8-hour shift", () => {
    expect(RUNAWAY_TIMER_HOURS).toBeGreaterThan(8);
  });
});
