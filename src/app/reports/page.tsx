import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { parseRange, formatRange, toISODate } from "@/lib/report-range";
import {
  budgetedHoursFor,
  personReport,
  projectReport,
  timesheet,
} from "@/server/reports";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { MetricCard, MetricGrid, HealthBadge } from "@/components/badges";

const TIMESHEET_PREVIEW = 60;

function hrs(n: number): string {
  return n.toFixed(2);
}

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

/** Over 100% is not an error — it is somebody working past their stated week. */
function utilTone(u: number | null): string {
  if (u === null) return "";
  if (u > 1.1) return "text-danger";
  if (u < 0.5) return "text-fg-subtle";
  return "";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const scope = await accessibleProjectIds(actor);

  // Everyone gets a report; what it contains narrows to what they may read.
  const seesEveryone = can(role, "worklog.viewAll");
  const seesMoney = can(role, "finance.view");

  const [projectRows, personRows, sheet, count] = await Promise.all([
    projectReport(range, scope),
    seesEveryone ? personReport(range, scope) : Promise.resolve([]),
    timesheet(range, scope, {
      limit: TIMESHEET_PREVIEW,
      userId: seesEveryone ? null : actor.id,
    }),
    unresolvedCount(actor.id),
  ]);

  // Money is fetched only when the role allows it, and only inside the RLS
  // opt-in — without both, the query returns nothing.
  const budgets = seesMoney
    ? await budgetedHoursFor(projectRows.map((p) => p.projectId))
    : new Map<string, number>();

  const totalHours = projectRows.reduce((s, p) => s + p.loggedHours, 0);
  const activeProjects = projectRows.filter((p) => p.loggedHours > 0).length;
  const exportHref = `/api/reports/timesheet?from=${toISODate(range.from)}&to=${toISODate(range.to)}`;

  return (
    <AppShell
      userName={me?.name ?? ""}
      userRole={role}
      inboxCount={count}
      title="Reports"
    >
      <SectionIntro
        eyebrow={formatRange(range).toUpperCase()}
        title="Where the hours went"
        description={
          seesEveryone
            ? "Built from the work logs themselves. Nothing here is maintained by hand."
            : "Your own entries, on the projects you work on."
        }
      />

      {/* GET, so a chosen window is a shareable URL and the export matches it. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={toISODate(range.from)}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toISODate(range.to)}
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary py-2 text-[12px]">
          Apply
        </button>
        <a
          href={exportHref}
          className="btn-secondary py-2 text-[12px]"
          download
        >
          Download CSV
        </a>
      </form>

      <MetricGrid>
        <MetricCard label="Hours logged" value={hrs(totalHours)} accent />
        <MetricCard
          label="Projects worked"
          value={String(activeProjects)}
          note={`of ${projectRows.length} live`}
        />
        <MetricCard
          label="People logging"
          value={String(personRows.filter((p) => p.loggedHours > 0).length || "—")}
          note={seesEveryone ? undefined : "not shown at your access level"}
        />
        <MetricCard label="Entries listed" value={String(sheet.length)} />
      </MetricGrid>

      {/* ---------------- per project ---------------- */}
      <section className="panel mb-4">
        <div className="panel-head">
          <div>
            <p className="eyebrow">BY PROJECT</p>
            <h3 className="m-0 text-[16px] tracking-[-.03em]">
              Logged against estimated
            </h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-2 font-bold">Project</th>
                <th className="px-3 py-2 text-right font-bold">In range</th>
                <th className="px-3 py-2 text-right font-bold">All time</th>
                <th className="px-3 py-2 text-right font-bold">Estimated</th>
                {seesMoney && (
                  <th className="px-3 py-2 text-right font-bold">Budget</th>
                )}
                <th className="px-3 py-2 text-right font-bold">Tasks</th>
                <th className="px-3 py-2 text-right font-bold">Blockers</th>
                <th className="px-5 py-2 font-bold">Health</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-fg-muted">
                    No projects in scope.
                  </td>
                </tr>
              ) : (
                projectRows.map((p) => {
                  const budget = budgets.get(p.projectId) ?? 0;
                  const over =
                    p.estimatedHours > 0 &&
                    p.loggedHoursAllTime > p.estimatedHours;
                  return (
                    <tr key={p.projectId} className="border-b border-border last:border-b-0">
                      <td className="px-5 py-2.5">
                        <strong>{p.code}</strong>{" "}
                        <span className="text-fg-muted">{p.name}</span>
                        {p.clientName && (
                          <div className="text-[9px] text-fg-subtle">
                            {p.clientName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {hrs(p.loggedHours)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono ${over ? "text-danger" : ""}`}
                      >
                        {hrs(p.loggedHoursAllTime)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-fg-muted">
                        {p.estimatedHours > 0 ? hrs(p.estimatedHours) : "—"}
                      </td>
                      {seesMoney && (
                        <td className="px-3 py-2.5 text-right font-mono text-fg-muted">
                          {budget > 0 ? hrs(budget) : "—"}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right font-mono text-fg-muted">
                        {p.tasksDone}/{p.tasksTotal}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono ${p.openBlockers > 0 ? "text-danger" : "text-fg-muted"}`}
                      >
                        {p.openBlockers || "—"}
                      </td>
                      <td className="px-5 py-2.5">
                        <HealthBadge health={p.health as never} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- per person ---------------- */}
      {seesEveryone && (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <p className="eyebrow">BY PERSON</p>
              <h3 className="m-0 text-[16px] tracking-[-.03em]">
                Logged against capacity
              </h3>
            </div>
            <span className="text-[11px] text-fg-muted">
              capacity = stated week spread over the range&rsquo;s working days
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-2 font-bold">Person</th>
                  <th className="px-3 py-2 text-right font-bold">Logged</th>
                  <th className="px-3 py-2 text-right font-bold">Capacity</th>
                  <th className="px-3 py-2 text-right font-bold">Utilisation</th>
                  <th className="px-5 py-2 text-right font-bold">Projects</th>
                </tr>
              </thead>
              <tbody>
                {personRows.map((p) => (
                  <tr key={p.userId} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-2.5">
                      {p.name}{" "}
                      <span className="text-[9px] text-fg-subtle">{p.role}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {hrs(p.loggedHours)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-muted">
                      {hrs(p.capacityHours)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-bold ${utilTone(p.utilisation)}`}
                    >
                      {pct(p.utilisation)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-fg-muted">
                      {p.projectCount || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------------- the entries ---------------- */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">
              {seesEveryone ? "EVERY ENTRY IN RANGE" : "YOUR ENTRIES IN RANGE"}
            </p>
            <h3 className="m-0 text-[16px] tracking-[-.03em]">Timesheet</h3>
          </div>
          <span className="text-[11px] text-fg-muted">
            newest {TIMESHEET_PREVIEW} shown · CSV has them all
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-2 font-bold">Date</th>
                <th className="px-3 py-2 font-bold">Person</th>
                <th className="px-3 py-2 font-bold">Project</th>
                <th className="px-3 py-2 font-bold">Task</th>
                <th className="px-3 py-2 text-right font-bold">Hours</th>
                <th className="px-5 py-2 font-bold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sheet.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-fg-muted">
                    Nothing logged in this range.
                  </td>
                </tr>
              ) : (
                sheet.map((r, i) => (
                  <tr
                    key={`${toISODate(r.workDate)}-${i}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-5 py-2 font-mono whitespace-nowrap">
                      {toISODate(r.workDate)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.personName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <strong>{r.projectCode}</strong>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {r.taskTitle ?? "General project work"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {hrs(r.hours)}
                    </td>
                    <td className="max-w-[320px] truncate px-5 py-2 text-fg-muted">
                      {r.notes}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
