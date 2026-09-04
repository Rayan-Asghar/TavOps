import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page skeleton, in one place.
 *
 * Toggl, Toggl Track, Plane and Harvest all stack the same five bands, in the
 * same order, on every list screen. Tavren had band 1 shared as `SectionIntro`
 * and nothing else, so filters, view switchers and totals were laid out afresh
 * on each page and drifted. Building the skeleton once makes every later screen
 * assembly rather than design.
 *
 *   1  TITLE      eyebrow, title, description, primary + secondary actions
 *   2  TABS       sub-views of the same data ("Time · Profitability")
 *   3  CONTROLS   date range, filters, grouping, view switcher
 *   4  SUMMARY    the totals the rows below add up to
 *   5  CONTENT    (the page itself, below this component)
 *
 * Bands 2-4 are optional. Their ORDER never varies, which is the whole point:
 * somebody scanning a second page already knows where the filters are.
 *
 * Rules taken from those four tools and worth keeping:
 *   - Exactly ONE filled button per page, top right. Everything else outlines.
 *   - Tabs are underline-active, never pills — pills read as filters.
 *   - Controls belong in the URL, so a copied link reproduces the view.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  actions,
  tabs,
  controls,
  summary,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  /** The one filled button. */
  primaryAction?: ReactNode;
  /** Outline buttons beside it: Export, Import, an overflow menu. */
  actions?: ReactNode;
  tabs?: PageTab[];
  controls?: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <header className="mb-7 mt-3.5">
      <div className="flex flex-col items-start justify-between gap-5 border-b border-fg pb-6 pt-6 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          {/* Clamped between two real steps of the scale (24 and 36) rather
              than 28 and 44, which belonged to neither. */}
          <h1 className="display m-0 text-[clamp(1.5rem,3.5vw,2.25rem)]">
            {title}
          </h1>
          {description && (
            <p className="m-0 mt-2 max-w-[560px] text-xs text-fg-muted">
              {description}
            </p>
          )}
        </div>
        {(primaryAction || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {primaryAction}
          </div>
        )}
      </div>

      {tabs && tabs.length > 0 && <PageTabs tabs={tabs} />}

      {controls && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border py-3">
          {controls}
        </div>
      )}

      {summary && <div className="pt-4">{summary}</div>}
    </header>
  );
}

export type PageTab = {
  href: string;
  label: string;
  active: boolean;
  /** Shown after the label. Omit rather than passing 0 — a zero badge reads as
   *  a problem where "nothing here" is the ordinary state. */
  count?: number;
};

/**
 * Band 2. Underline-active, and real links so a tab is shareable and the page
 * stays server-rendered — the same argument `project-tabs.tsx` makes for
 * keeping the project's tab in the URL.
 */
export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-bold transition-colors duration-150 ease-out-quad ${
            t.active
              ? "border-brand text-fg"
              : "border-transparent text-fg-muted hover:text-fg"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1.5 text-fg-subtle tabular-nums">{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export type SummaryFigure = {
  label: string;
  value: string;
  /** A second line, for the basis or a comparison. */
  note?: string;
  /** Renders a small square before the label, for figures that split a total. */
  swatch?: "billable" | "non-billable" | "neutral";
  /** Links to the rows this figure counted. A figure you cannot drill into is
   *  one nobody can check. */
  href?: string;
  tone?: "default" | "danger";
};

/**
 * Band 4. Deliberately flatter than `MetricCard`, which is 180px tall and
 * belongs on a dashboard — inside a header that height pushes the actual
 * content below the fold.
 *
 * Figures that split a total carry a swatch, so "Billable 96 / Non-billable 32"
 * reads as two halves of one number rather than two unrelated stats. That is
 * how Harvest's approvals header does it, and it is why the split is legible
 * without a chart.
 */
export function SummaryStrip({ figures }: { figures: SummaryFigure[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10">
      {figures.map((f) => {
        const body = (
          <>
            <dt className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[.12em] text-fg-muted">
              {f.swatch && (
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-[2px] ${
                    f.swatch === "billable"
                      ? "bg-brand"
                      : f.swatch === "non-billable"
                        ? "bg-border-strong"
                        : "bg-fg-subtle"
                  }`}
                />
              )}
              {f.label}
            </dt>
            <dd
              className={`m-0 mt-1 text-xl font-bold tabular-nums ${
                f.tone === "danger" ? "text-danger" : "text-fg"
              }`}
            >
              {f.value}
            </dd>
            {f.note && (
              <dd className="m-0 mt-0.5 text-2xs text-fg-subtle">{f.note}</dd>
            )}
          </>
        );

        return f.href ? (
          <Link
            key={f.label}
            href={f.href}
            className="group min-w-0 rounded-md transition-colors duration-150 ease-out-quad hover:bg-surface-2"
          >
            {body}
          </Link>
        ) : (
          <div key={f.label} className="min-w-0">
            {body}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The previous name for band 1, kept so the eleven pages that already call it
 * keep working. New screens use `PageHeader`; these migrate as they are rebuilt
 * rather than in one sweep that would touch every page at once.
 */
export function SectionIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
    />
  );
}
