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
  hoursByDay,
} from "@/server/reports";
import { SectionIntro } from "@/components/app-shell";

import { fmtDate, hrs } from "@/lib/format";
import { DataTable, EmptyCell, Th } from "@/components/ui";
import { ReportsVisual } from "@/components/reports-visual";

export const metadata = { title: "Reports" };
const TIMESHEET_PREVIEW = 60;



/** Over 100% is not an error — it is somebody working past their stated week. */

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

  const [projectRows, personRows, sheet, days] = await Promise.all([
    projectReport(range, scope),
    seesEveryone ? personReport(range, scope) : Promise.resolve([]),
    timesheet(range, scope, {
      limit: TIMESHEET_PREVIEW,
      userId: seesEveryone ? null : actor.id,
    }),
    hoursByDay(range, scope),
  ]);

  // Money is fetched only when the role allows it, and only inside the RLS
  // opt-in — without both, the query returns nothing.
  const budgets = seesMoney
    ? await budgetedHoursFor(projectRows.map((p) => p.projectId))
    : new Map<string, number>();

  const totalHours = projectRows.reduce((s, p) => s + p.loggedHours, 0);
  const exportHref = `/api/reports/timesheet?from=${toISODate(range.from)}&to=${toISODate(range.to)}`;

  return (
    <>
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
        <button type="submit" className="btn-primary btn-sm">
          Apply
        </button>
        <a
          href={exportHref}
          className="btn-secondary btn-sm"
          download
        >
          Download CSV
        </a>
      </form>



        <ReportsVisual
          days={days}
          projectRows={projectRows}
          personRows={personRows}
          budgets={budgets}
          totalHours={totalHours}
          seesEveryone={seesEveryone}
        />

      {/* ---------------- the entries ---------------- */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">
              {seesEveryone ? "EVERY ENTRY IN RANGE" : "YOUR ENTRIES IN RANGE"}
            </p>
            <h3 className="m-0 text-lg tracking-[-.03em]">Timesheet</h3>
          </div>
          <span className="text-xs text-fg-muted">
            newest {TIMESHEET_PREVIEW} shown · CSV has them all
          </span>
        </div>
        {/* 60 rows: the only table here long enough to lose its own header. */}
        <DataTable minWidth={680} maxHeight={520}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Person</Th>
                <Th>Project</Th>
                <Th>Task</Th>
                <Th numeric>Hours</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.length === 0 ? (
                <EmptyCell colSpan={6}>
                  {`No entries between ${fmtDate(range.from)} and ${fmtDate(range.to)}. Widen the range above to see more.`}
                </EmptyCell>
              ) : (
                sheet.map((r, i) => (
                  <tr
                    key={`${toISODate(r.workDate)}-${i}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-5 py-2 tabular whitespace-nowrap">
                      {toISODate(r.workDate)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.personName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <strong>{r.projectCode}</strong>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {r.taskTitle ?? "General project work"}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {hrs(r.hours)}
                    </td>
                    <td className="max-w-[320px] truncate px-5 py-2 text-fg-muted">
                      {r.notes}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
      </section>
    </>
  );
}
