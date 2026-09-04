import type { ReactNode } from "react";
import { bands, bulletGeometry, niceMax, sparkPath } from "@/lib/chart-scale";

/**
 * Inline SVG charts. Server components — no client JS, no hydration, no chart
 * arriving a beat after the table it belongs to.
 *
 * DESIGN-STANDARD 3.7 sets the rules these follow:
 *  - sparklines carry **shape only**: no axes, no gridlines, no meaning that
 *    depends on a tooltip. The number beside them carries the value.
 *  - never rely on colour alone. ~1 in 12 men have a colour vision deficiency,
 *    and 1.4.11 wants 3:1 for meaningful graphics — so an overrun is a *word*
 *    and a shape change, with colour as the third channel rather than the only one.
 *  - every chart gets a text equivalent. Here that is usually the figure printed
 *    next to it; where it is not, `ChartFrame` carries an sr-only table.
 *
 * Colours come from the theme tokens via `currentColor` and the semantic
 * classes, so these read correctly in both themes without a single `dark:`.
 */

/* ------------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  width = 72,
  height = 22,
  label,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  /** What the shape is of. Read out instead of the drawing. */
  label: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const d = sparkPath(values, width, height, 1.5);
  const last = values[values.length - 1];
  const max = Math.max(...values, 0) || 1;
  const lastY = height - 0.75 - (last / max) * (height - 1.5);
  const lastX = width - 0.75;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={`overflow-visible ${className}`}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The endpoint is emphasised because "now" is the point of a trend. */}
      <circle cx={lastX} cy={lastY} r={2} fill="currentColor" />
    </svg>
  );
}

/* --------------------------------------------------------------------- bullet */

/**
 * Value against a target, in one line.
 *
 * 3.7 recommends exactly this over a gauge whenever several KPIs sit side by
 * side, and the corpus agrees for the compact case. The target is a marker rule
 * rather than a second bar, so "am I past it" is a position, not a comparison.
 */
export function BulletBar({
  value,
  target,
  max,
  label,
  valueLabel,
  targetLabel,
  height = 6,
}: {
  value: number;
  target: number;
  max?: number;
  label: string;
  valueLabel: string;
  targetLabel?: string;
  height?: number;
}) {
  const { valuePct, targetPct, over } = bulletGeometry(value, target, max);

  return (
    <div
      role="img"
      aria-label={
        targetLabel
          ? `${label}: ${valueLabel} of ${targetLabel}${over ? ", over" : ""}`
          : `${label}: ${valueLabel}`
      }
      className="relative w-full overflow-hidden rounded-sm bg-surface-2"
      style={{ height }}
    >
      <div
        className={`h-full rounded-sm ${over ? "bg-danger" : "bg-fill-strong"}`}
        style={{ width: `${valuePct}%` }}
      />
      {targetPct > 0 && targetPct < 100 && (
        /* A 2px rule, not a tick below the bar: at this height a marker outside
           the track is invisible. */
        <span
          aria-hidden
          className="absolute inset-y-0 w-[2px] bg-fg"
          style={{ left: `calc(${targetPct}% - 1px)` }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ mini bars */

export function MiniBars({
  values,
  labels,
  width = 240,
  height = 56,
  highlightLast = true,
  emptyLabel = "No hours in this range",
}: {
  values: number[];
  labels: string[];
  width?: number;
  height?: number;
  highlightLast?: boolean;
  emptyLabel?: string;
}) {
  const total = values.reduce((a, b) => a + b, 0);
  if (values.length === 0 || total === 0) {
    return <p className="m-0 py-4 text-xs text-fg-muted">{emptyLabel}</p>;
  }
  const top = niceMax(Math.max(...values));
  const { x, bandWidth } = bands(values.length, width);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Hours per day. Highest ${top}.`}
      className="block text-fg"
    >
      {/* A baseline, so short bars sit on something rather than floating. Drawn
          inside the viewBox at the very bottom so `preserveAspectRatio="none"`
          cannot squash it out of view. */}
      <line
        x1={0}
        y1={height - 0.5}
        x2={width}
        y2={height - 0.5}
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="text-border"
      />
      {values.map((v, i) => {
        const h = (v / top) * height;
        return (
          <rect
            key={i}
            x={x(i)}
            y={height - h}
            width={bandWidth}
            height={Math.max(v > 0 ? 1 : 0, h)}
            rx={1}
            className={
              highlightLast && i === values.length - 1
                ? "fill-brand"
                : "fill-fg-subtle"
            }
          >
            {/* Native tooltip: no JS, and it works on keyboard focus in most
                browsers, which a custom hover layer would not. */}
            <title>{`${labels[i]}: ${v.toFixed(2)}h`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------------- frame */

/**
 * A caption and a text equivalent around any chart. 3.7 asks for a table
 * fallback or an aria summary on every one.
 */
export function ChartFrame({
  title,
  meta,
  rows,
  children,
}: {
  title: string;
  meta?: ReactNode;
  /** The same numbers, for anyone who cannot use the drawing. */
  rows?: { label: string; value: string }[];
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
          {title}
        </span>
        {meta && <span className="text-2xs text-fg-muted">{meta}</span>}
      </figcaption>
      {children}
      {rows && rows.length > 0 && (
        <table className="sr-only">
          <caption>{title}</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
