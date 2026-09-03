import type { CSSProperties } from "react";

/**
 * Loading placeholders.
 *
 * DESIGN-STANDARD 4.6 r42 sets the thresholds: under 1s shows *nothing*, and a
 * full-screen load gets a skeleton rather than a spinner. Next renders a route's
 * `loading.tsx` the instant navigation starts, which would flash a skeleton on
 * every fast page — so the whole placeholder is delayed 300ms and only becomes
 * visible if the load is actually slow. Under `prefers-reduced-motion` the app's
 * global rule collapses the fade; the delay survives, which is the part that
 * matters here.
 *
 * r43: skeletons are for containers and data — tables, lists, cards — never for
 * modals, toasts or actions, and never a frame-only shape that just outlines a
 * header and footer. Every shape below stands in for content that will occupy
 * the same box, at the same height, so nothing jumps when the real rows land.
 */

export function Skeleton({
  w,
  h = 14,
  rounded = "sm",
  className = "",
}: {
  /** CSS width. Defaults to filling the track. */
  w?: string;
  /** Height in px — match the real element so the swap does not shift layout. */
  h?: number;
  rounded?: "sm" | "md" | "full";
  className?: string;
}) {
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "md" ? "rounded-md" : "rounded-sm";
  return (
    <span
      aria-hidden
      className={`block bg-surface-2 ${radius} ${className}`}
      style={{ width: w ?? "100%", height: h } as CSSProperties}
    />
  );
}

/** A few lines of prose, last one short, the way real text sits. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={12} w={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

/**
 * Table rows at the app's real row height. `rowH` must match the table being
 * stood in for, or the content jumps when it arrives.
 */
export function SkeletonRows({
  rows = 6,
  cols = 4,
  rowH = 38,
}: {
  rows?: number;
  cols?: number;
  rowH?: number;
}) {
  return (
    <span className="block">
      {Array.from({ length: rows }, (_, r) => (
        <span
          key={r}
          className="flex items-center gap-4 border-b border-border px-5 last:border-b-0"
          style={{ height: rowH }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} h={10} w={c === 0 ? "22%" : c === cols - 1 ? "12%" : "16%"} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** The bordered metric grid, at its real 180px tile height. */
export function SkeletonMetrics({ tiles = 4 }: { tiles?: number }) {
  return (
    <span className="my-6 grid grid-cols-1 border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <span
          key={i}
          className="block min-h-[180px] border-b border-r border-border bg-surface p-5"
        >
          <Skeleton h={10} w="52%" />
          <span className="mt-6 block">
            <Skeleton h={34} w="38%" rounded="md" />
          </span>
          <span className="mt-4 block">
            <Skeleton h={10} w="80%" />
          </span>
        </span>
      ))}
    </span>
  );
}
