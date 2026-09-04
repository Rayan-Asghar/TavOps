import { describe, expect, it } from "vitest";
import {
  bands,
  bulletGeometry,
  linearScale,
  niceMax,
  sparkPath,
} from "./chart-scale";

/**
 * The parts of a chart that can be wrong invisibly.
 *
 * A bar 3% too long, an axis that stops short of its own maximum, or a NaN in a
 * path `d` — which draws nothing at all, silently — are the failures nobody
 * catches by looking. Everything here is the arithmetic; the components only
 * turn these numbers into elements.
 */

describe("linearScale", () => {
  it("maps the domain onto the range", () => {
    const s = linearScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it("inverts when the range does, which is how SVG y-axes work", () => {
    const y = linearScale(0, 10, 40, 0); // 40px tall, origin at the top
    expect(y(0)).toBe(40);
    expect(y(10)).toBe(0);
  });

  it("does not divide by zero when every value is identical", () => {
    const s = linearScale(7, 7, 0, 100);
    expect(s(7)).toBe(0);
    expect(Number.isNaN(s(7))).toBe(false);
  });
});

describe("niceMax", () => {
  it("rounds up to a number a person would say out loud", () => {
    expect(niceMax(37.4)).toBe(40);
    expect(niceMax(4.2)).toBe(5);
    expect(niceMax(140)).toBe(150);
    // A 1-2-5 ladder would send these to 50 and 200, leaving a quarter of the
    // chart empty above the data.
    expect(niceMax(23.03)).toBe(25);
    expect(niceMax(46.83)).toBe(50);
  });

  it("never returns zero, so nothing downstream divides by it", () => {
    expect(niceMax(0.7)).toBeCloseTo(0.8);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(NaN)).toBe(1);
  });
});

describe("bands", () => {
  it("spaces columns evenly and centres each in its slot", () => {
    const { x, bandWidth } = bands(4, 100, 0.2);
    expect(bandWidth).toBeCloseTo(20);
    expect(x(0)).toBeCloseTo(2.5);
    expect(x(3)).toBeCloseTo(77.5);
    // The last band ends inside the width, not past it.
    expect(x(3) + bandWidth).toBeLessThanOrEqual(100);
  });

  it("survives an empty series", () => {
    const { x, bandWidth } = bands(0, 100);
    expect(bandWidth).toBe(0);
    expect(x(0)).toBe(0);
  });
});

describe("sparkPath", () => {
  it("starts the axis at zero so a quiet month is not flattened to nothing", () => {
    // With a min-based domain, 10 would sit on the floor and read as zero.
    const d = sparkPath([10, 20], 100, 40);
    const ys = [...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]); // 10 is lower on screen than 20
    expect(ys[0]).toBeLessThan(40); // but not on the floor
  });

  it("never emits NaN, which would silently draw nothing", () => {
    for (const series of [[0, 0, 0], [5], [], [1, 2, 3]]) {
      expect(sparkPath(series, 100, 40)).not.toMatch(/NaN/);
    }
  });

  it("draws a flat line for a single point rather than a dot in the corner", () => {
    expect(sparkPath([7], 100, 40)).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
  });

  it("keeps the stroke inside the box", () => {
    const d = sparkPath([0, 100], 100, 40, 2);
    const ys = [...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    // Half the stroke width of padding, so a 2px line is not clipped in half.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(39);
  });
});

describe("bulletGeometry", () => {
  it("fills proportionally against the ceiling", () => {
    const g = bulletGeometry(25, 50, 100);
    expect(g.valuePct).toBe(25);
    expect(g.targetPct).toBe(50);
    expect(g.over).toBe(false);
  });

  it("flags an overrun and still paints the marker inside the track", () => {
    // V-001 in the seed data: 18 hours logged against a 6 hour estimate.
    const g = bulletGeometry(18, 6);
    expect(g.over).toBe(true);
    expect(g.valuePct).toBe(100);
    expect(g.targetPct).toBeCloseTo(33.33, 1);
  });

  it("does not call landing exactly on the estimate an overrun", () => {
    expect(bulletGeometry(10, 10).over).toBe(false);
  });

  it("treats a missing target as no target rather than an instant overrun", () => {
    const g = bulletGeometry(12, 0);
    expect(g.over).toBe(false);
    expect(g.targetPct).toBe(0);
  });

  it("clamps rather than emitting a negative width", () => {
    expect(bulletGeometry(-4, 10).valuePct).toBe(0);
  });
});
