/**
 * Scale maths for the inline SVG charts.
 *
 * Pure and separate from the components on purpose, the same way `grid-totals`
 * and `report-range` are: this is the part that can be wrong in a way nobody
 * notices — a bar that is 3% too long, an axis that does not reach its own
 * maximum — so it is the part that gets tests. The components around it only
 * turn these numbers into elements.
 *
 * DESIGN-STANDARD 3.7 governs what these are allowed to draw: sparklines carry
 * shape only and get no axes or gridlines, and every chart needs a value the
 * reader can also get as text, because "label directly on the mark" beats a
 * legend round-trip.
 */

/** Maps a value onto a pixel position. Guards the degenerate zero-range case. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  const span = domainMax - domainMin;
  if (span === 0) {
    // Every value identical: park them at the bottom rather than dividing by
    // zero and painting NaN into the `d` attribute, which silently draws nothing.
    return () => rangeMin;
  }
  return (v: number) =>
    rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

/**
 * A rounded upper bound so a bar chart's top gridline is a number a person
 * would say out loud — 40, not 37.4.
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  /* A finer ladder than the usual 1-2-5. That one rounds 37.4 up to 50, which
     wastes a quarter of the chart's height and puts the top gridline nowhere
     near the data. These steps still read as round numbers out loud. */
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const normalised = max / magnitude;
  const step = steps.find((s) => normalised <= s) ?? 10;
  return step * magnitude;
}

/** Evenly spaced band positions, the way a bar chart lays out its columns. */
export function bands(
  count: number,
  width: number,
  gapRatio = 0.28,
): { x: (i: number) => number; bandWidth: number } {
  if (count <= 0) return { x: () => 0, bandWidth: 0 };
  const slot = width / count;
  const bandWidth = Math.max(1, slot * (1 - gapRatio));
  return {
    x: (i: number) => i * slot + (slot - bandWidth) / 2,
    bandWidth,
  };
}

/**
 * An SVG path through a series, for a sparkline.
 *
 * The domain floor is 0 rather than the series minimum: these are hour totals,
 * and starting the axis at the smallest value would make a quiet month look
 * like zero and exaggerate every difference above it.
 */
export function sparkPath(
  values: number[],
  width: number,
  height: number,
  strokeWidth = 1.5,
): string {
  if (values.length === 0) return "";
  const pad = strokeWidth / 2;
  const max = Math.max(...values, 0);
  const y = linearScale(0, max || 1, height - pad, pad);
  if (values.length === 1) {
    const mid = height - pad;
    return `M ${pad} ${mid} L ${width - pad} ${mid}`;
  }
  const step = (width - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${y(v)}`)
    .join(" ");
}

/**
 * A bullet measure: how much of the track the value fills, and how far along the
 * target marker sits. Both clamped to the track, so an overrun paints a full bar
 * with the marker still visible rather than a bar running off the end.
 */
export function bulletGeometry(
  value: number,
  target: number,
  max?: number,
): { valuePct: number; targetPct: number; over: boolean } {
  const ceiling = max ?? Math.max(value, target, 1);
  const clamp = (n: number) => Math.max(0, Math.min(100, (n / ceiling) * 100));
  return {
    valuePct: clamp(value),
    targetPct: clamp(target),
    // Strictly greater: landing exactly on the estimate is not an overrun.
    over: target > 0 && value > target,
  };
}
