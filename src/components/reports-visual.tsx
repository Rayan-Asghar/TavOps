import Link from "next/link";
import { BulletBar, ChartFrame, MiniBars, Sparkline } from "./charts";
import { HealthBadge } from "./badges";
import { hrs, pct } from "@/lib/format";
import type {
  DayHours,
  PersonReportRow,
  ProjectReportRow,
} from "@/server/reports";

/**
 * The visual reading of "where the hours went".
 *
 * This is the bolder of two treatments of the same data, for comparison. The
 * strict one keeps the standard's flatness; this one spends the page's attention
 * budget on shape rather than on rows of figures. Both obey the rules that are
 * not negotiable — contrast, tabular figures, colour never the only channel, and
 * no animation on anything frequent.
 *
 * Nothing here needs a query the page did not already run, except `hoursByDay`.
 * Every other number was already on screen as text.
 */

export function ReportsVisual({
  days,
  projectRows,
  personRows,
  budgets,
  totalHours,
  seesEveryone,
}: {
  days: DayHours[];
  projectRows: ProjectReportRow[];
  personRows: PersonReportRow[];
  budgets: Map<string, number>;
  totalHours: number;
  seesEveryone: boolean;
}) {
  const logged = days.map((d) => d.hours);
  const busiest = days.reduce<DayHours | null>(
    (best, d) => (best === null || d.hours > best.hours ? d : best),
    null,
  );
  const daysWithWork = days.filter((d) => d.hours > 0).length;

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <>
      {/* ------------------------------------------------------ hero: the shape */}
      <section className="panel mb-4 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <ChartFrame
              title="Hours per day"
              meta={
                busiest && busiest.hours > 0
                  ? `busiest ${dayLabel(busiest.day)} · ${hrs(busiest.hours)}h`
                  : undefined
              }
              rows={days
                .filter((d) => d.hours > 0)
                .map((d) => ({ label: dayLabel(d.day), value: `${hrs(d.hours)}h` }))}
            >
              <MiniBars
                values={logged}
                labels={days.map((d) => dayLabel(d.day))}
                height={92}
                highlightLast={false}
              />
              {/* Just the two ends. "peak" used to sit in the middle of this
                  row, where it read as a label for the bar above it — and the
                  caption already names the busiest day. */}
              <div className="mt-2 flex justify-between border-t border-border pt-2 text-2xs text-fg-muted">
                <span>{days.length > 0 ? dayLabel(days[0].day) : ""}</span>
                <span>
                  {days.length > 0 ? dayLabel(days[days.length - 1].day) : ""}
                </span>
              </div>
            </ChartFrame>
          </div>

          {/* The one figure the page exists to answer, at the size 3.7 wants for
              a KPI value, with its own context line under it. */}
          <div className="flex flex-col justify-center p-5">
            <span className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
              Hours logged
            </span>
            <strong className="tabular mt-2 block text-5xl leading-none tracking-[-.045em]">
              {hrs(totalHours)}
            </strong>
            <p className="m-0 mt-3 text-xs text-fg-muted">
              across {daysWithWork} day{daysWithWork === 1 ? "" : "s"} of{" "}
              {days.length} in range
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- projects: against plan */}
      <section className="panel mb-4">
        <div className="panel-head">
          <div>
            <p className="eyebrow">BY PROJECT</p>
            <h3 className="m-0 text-xl tracking-[-.035em]">Logged against estimated</h3>
          </div>
          <span className="text-xs text-fg-muted">
            marker is the estimate
          </span>
        </div>
        <ul>
          {projectRows.map((p) => {
            const budget = budgets.get(p.projectId);
            const over = p.estimatedHours > 0 && p.loggedHoursAllTime > p.estimatedHours;
            return (
              <li key={p.projectId} className="border-b border-border px-5 py-4 last:border-b-0">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    href={`/projects/${p.projectId}`}
                    className="min-w-0 text-xs font-bold hover:text-brand"
                  >
                    <span className="font-mono text-2xs text-fg-muted">{p.code}</span>{" "}
                    {p.name}
                  </Link>
                  <span className="flex items-center gap-3">
                    <HealthBadge health={p.health} />
                    {/* The number is never only a colour: "over" is a word. */}
                    <span className={`tabular text-xs ${over ? "font-bold text-danger" : "text-fg-muted"}`}>
                      {hrs(p.loggedHoursAllTime)}
                      {p.estimatedHours > 0 && (
                        <span className="text-fg-subtle">
                          {" / "}
                          {hrs(p.estimatedHours)}
                        </span>
                      )}
                      {over && " over"}
                    </span>
                  </span>
                </div>
                <BulletBar
                  value={p.loggedHoursAllTime}
                  target={p.estimatedHours}
                  max={budget && budget > 0 ? budget : undefined}
                  label={`${p.code} hours against estimate`}
                  valueLabel={`${hrs(p.loggedHoursAllTime)} hours`}
                  targetLabel={p.estimatedHours > 0 ? `${hrs(p.estimatedHours)} estimated` : undefined}
                />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
                  <span className="tabular">
                    {p.tasksDone}/{p.tasksTotal} tasks
                  </span>
                  {p.contributors > 0 && (
                    <span className="tabular">
                      {p.contributors} contributor{p.contributors === 1 ? "" : "s"}
                    </span>
                  )}
                  {p.openBlockers > 0 && (
                    <span className="font-bold text-danger">
                      {p.openBlockers} blocked
                    </span>
                  )}
                  {budget && budget > 0 && (
                    <span className="tabular">budget {hrs(budget)}h</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* -------------------------------------------- people: against capacity */}
      {seesEveryone && personRows.length > 0 && (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <p className="eyebrow">BY PERSON</p>
              <h3 className="m-0 text-xl tracking-[-.035em]">Logged against capacity</h3>
            </div>
            <span className="text-xs text-fg-muted">
              capacity = stated week over the range&rsquo;s working days
            </span>
          </div>
          <ul>
            {personRows.map((p) => (
              <li
                key={p.userId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
              >
                <span className="min-w-0 truncate text-xs font-bold">
                  {p.name}
                  <span className="ml-1.5 font-medium text-fg-muted">{p.role}</span>
                </span>
                <span className="col-span-2 sm:col-span-1">
                  <BulletBar
                    value={p.loggedHours}
                    target={p.capacityHours}
                    max={p.capacityHours || undefined}
                    label={`${p.name} hours against capacity`}
                    valueLabel={`${hrs(p.loggedHours)} hours`}
                    targetLabel={`${hrs(p.capacityHours)} capacity`}
                  />
                </span>
                <span className="tabular shrink-0 text-right text-xs text-fg-muted">
                  <span className="font-bold text-fg">{hrs(p.loggedHours)}</span>
                  <span className="text-fg-subtle"> / {hrs(p.capacityHours)}</span>
                  <span className="ml-2 inline-block w-[42px] text-right">
                    {p.utilisation === null ? "—" : pct(p.utilisation)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The sparkline used in the strict view's table, kept here beside its siblings. */
export function TrendCell({ values, label }: { values: number[]; label: string }) {
  return <Sparkline values={values} label={label} className="text-fg-muted" />;
}
