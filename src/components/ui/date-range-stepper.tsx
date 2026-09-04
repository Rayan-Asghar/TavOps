import Link from "next/link";
import {
  formatRange,
  isCalendarMonth,
  stepRange,
  toISODate,
  type DateRange,
} from "@/lib/report-range";

/**
 * `← This month · 1–30 Sep 2026 →`
 *
 * The control every one of Toggl, Toggl Track, Plane and Harvest puts at the
 * left of the toolbar, and the one Tavren was missing: `/reports` had two bare
 * date inputs and an Apply button, so moving to last month meant typing two
 * dates correctly.
 *
 * Server-rendered links, not client state. Stepping is a navigation, so the
 * window stays in the URL, the page stays a server component, the export link
 * beside it keeps matching what is on screen, and Back does what Back should.
 *
 * `stepRange` steps a calendar month by months and anything else by its own
 * length — see the argument there.
 */
export function DateRangeStepper({
  range,
  /** The route to link to. Other params are preserved by the caller. */
  basePath,
  params,
}: {
  range: DateRange;
  basePath: string;
  /** Everything else in the query string, so stepping keeps the other filters. */
  params?: Record<string, string | undefined>;
}) {
  const href = (r: DateRange) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v) q.set(k, v);
    }
    q.set("from", toISODate(r.from));
    q.set("to", toISODate(r.to));
    return `${basePath}?${q.toString()}`;
  };

  const prev = stepRange(range, -1);
  const next = stepRange(range, 1);
  const unit = isCalendarMonth(range) ? "month" : "period";

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-surface">
      <Link
        href={href(prev)}
        aria-label={`Previous ${unit}`}
        className="grid h-11 w-11 place-items-center rounded-l-lg text-fg-muted transition-colors duration-150 ease-out-quad hover:bg-surface-2 hover:text-fg"
      >
        <Chevron dir="left" />
      </Link>
      <span className="border-x border-border px-3 py-1 text-xs font-bold tabular-nums">
        {formatRange(range)}
      </span>
      <Link
        href={href(next)}
        aria-label={`Next ${unit}`}
        className="grid h-11 w-11 place-items-center rounded-r-lg text-fg-muted transition-colors duration-150 ease-out-quad hover:bg-surface-2 hover:text-fg"
      >
        <Chevron dir="right" />
      </Link>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}
