import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { loadWorkGrid, monthOf } from "@/server/grid-queries";
import { unresolvedCount } from "@/server/notifications";
import { activeSessionFor } from "@/server/timer";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { GridMonthTabs } from "@/components/grid-month-tabs";
import { WorkLogGrid } from "@/components/work-log-grid";
import { EmptyState } from "@/components/ui";
import type { RawParams } from "@/lib/list-params";

export const metadata = { title: "Timesheet" };

/**
 * The work-log grid: one project, one month, laid out like the project's sheet.
 *
 * The scope lives in the URL — `?project=`, `?person=`, `?month=` — because
 * those three decide which rows are fetched and who is allowed to see them, so
 * the page stays server-rendered and `lib/access.ts` keeps deciding what is
 * visible. Everything the grid holds while you type (the active cell, the
 * selection, a half-entered value) stays in the client: none of it is shareable
 * and none of it is an access decision.
 *
 * Note that `page`/`pageSize` from `list-params.ts` deliberately do NOT apply
 * here. A month is the page. Paginating a spreadsheet breaks select-all, breaks
 * a paste that straddles the boundary, and makes the totals above the grid a
 * lie about what is below it.
 */
export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // Read from the database rather than trusting the session, as /reports does:
  // a role changed after sign-in should take effect on the next page load.
  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  const params = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";

  const [scope, inbox, session] = await Promise.all([
    accessibleProjectIds(actor),
    unresolvedCount(actor.id),
    activeSessionFor(actor.id),
  ]);

  const options = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .where(scope === null ? undefined : inArray(projects.id, scope))
    .orderBy(asc(projects.code));

  const shell = {
    userName: me?.name ?? "",
    userRole: role,
    inboxCount: inbox,
    title: "Timesheet",
  };

  if (options.length === 0) {
    return (
      <AppShell {...shell}>
        <SectionIntro
          eyebrow="TIMESHEET"
          title="Nothing to log against"
          description="You are not on a project yet."
        />
        <EmptyState>
          Work is logged against a project. Once you are added to one, its
          timesheet appears here.
        </EmptyState>
      </AppShell>
    );
  }

  const projectId =
    options.find((p) => p.id === one(params.project))?.id ?? options[0].id;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(params.month))
    ? one(params.month)
    : monthOf(new Date());

  // Without worklog.viewAll the query pins the person to the actor anyway; the
  // filter is only offered to someone it can mean something for.
  const seesEveryone = can(role, "worklog.viewAll");
  const requestedPerson = seesEveryone ? one(params.person) || null : null;

  const grid = await loadWorkGrid(actor, role, {
    projectId,
    personId: requestedPerson,
    month,
  });

  const scoped: RawParams = {
    project: projectId,
    ...(grid.personId && seesEveryone ? { person: grid.personId } : {}),
    month,
  };

  return (
    <AppShell {...shell}>
      <SectionIntro
        eyebrow={`${grid.project.code} · ${grid.monthLabel.toUpperCase()}`}
        title="Timesheet"
        description="The same rows as this project's work-log sheet, editable here. Corrections keep their history."
      />

      {/* A GET form, like every other filter in the app: no JavaScript, and the
          chosen scope is a URL somebody can send to somebody else. */}
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="project">Project</label>
          <select
            id="project"
            name="project"
            defaultValue={projectId}
            className="field field-sm min-w-[220px]"
          >
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>

        {seesEveryone && (
          <div>
            <label className="label" htmlFor="person">Person</label>
            <select
              id="person"
              name="person"
              defaultValue={grid.personId ?? ""}
              className="field field-sm min-w-[180px]"
            >
              <option value="">Everyone</option>
              {grid.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <input type="hidden" name="month" value={month} />
        <button type="submit" className="btn-secondary btn-sm">
          Show
        </button>
        <a
          className="btn-ghost btn-sm"
          href={`/api/reports/worklog-grid?project=${projectId}&month=${month}${
            grid.personId ? `&person=${grid.personId}` : ""
          }`}
        >
          Export CSV
        </a>
      </form>

      <GridMonthTabs months={grid.months} active={month} params={scoped} />

      {grid.truncated && (
        <p className="mb-4 rounded-xl border border-warn bg-warn-soft px-4 py-3 text-xs font-bold text-fg">
          This month has more entries than the grid edits at once. Narrow it to
          one person, or use the CSV export.
        </p>
      )}

      {/* The totals strip lives inside the grid so it tracks what is on screen
          as cells change, rather than only what the last server render saw. */}
      <WorkLogGrid
        rows={grid.rows}
        projectId={grid.project.id}
        personId={grid.personId}
        month={month}
        showPerson={grid.personId === null}
        monthLocked={grid.monthLocked}
        canCreate={can(role, "worklog.create")}
        viewerName={me?.name ?? "You"}
        // Only when it is running on the project being shown; a timer on
        // another project belongs to that project's grid, not this one.
        timer={
          session && session.projectId === projectId
            ? {
                id: session.id,
                taskTitle: session.taskTitle,
                status: session.status as "running" | "paused",
                accumulatedSeconds: session.accumulatedSeconds,
                resumedAt: session.resumedAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </AppShell>
  );
}
