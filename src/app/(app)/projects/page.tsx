import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, count as countRows, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, clients, projects, tasks, users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { SectionIntro } from "@/components/app-shell";
import { HealthBadge, Badge } from "@/components/badges";
import { can } from "@/lib/rbac";


import { fmtDate } from "@/lib/format";
import { EmptyState, ListFilters, Pagination } from "@/components/ui";
import { DensityToggle } from "@/components/density-toggle";
import { BulletBar } from "@/components/charts";
import { projectMoneyRows } from "@/server/margin-queries";
import { CardMoney, MoneyCells } from "@/components/project-money-cells";
import { DENSITY_COOKIE, parseDensity } from "@/lib/density";

import {
  offsetFor,
  pageInfo,
  parseListParams,
  type RawParams,
} from "@/lib/list-params";
export const metadata = { title: "Projects" };
const SORTABLE = ["name", "due", "health"] as const;
const PAGE_SIZE = 24;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const density = parseDensity((await cookies()).get(DENSITY_COOKIE)?.value);
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [scope] = await Promise.all([
    accessibleProjectIds(actor),
  ]);

  const params = await searchParams;
  const list = parseListParams(params, {
    sortable: SORTABLE,
    defaultSort: "name",
    pageSize: PAGE_SIZE,
  });

  const where = and(
    ne(projects.lifecycle, "archived"),
    scope === null ? sql`true` : inArray(projects.id, scope),
    list.q
      ? or(
          ilike(projects.name, `%${list.q}%`),
          ilike(projects.code, `%${list.q}%`),
          ilike(clients.name, `%${list.q}%`),
        )
      : undefined,
  );

  const dir = list.desc ? desc : asc;
  const orderBy =
    list.sort === "due"
      ? [dir(projects.internalDueDate)]
      : list.sort === "health"
        ? [dir(projects.health), asc(projects.name)]
        : [dir(projects.name)];

  const empty = scope !== null && scope.length === 0;

  const [rows, total] = empty
    ? [[], 0]
    : await Promise.all([
      db
          .select({
            id: projects.id,
            code: projects.code,
            name: projects.name,
            description: projects.description,
            projectType: projects.projectType,
            health: projects.health,
            lifecycle: projects.lifecycle,
            clientName: clients.name,
            billingModel: projects.billingModel,
            internalDueDate: projects.internalDueDate,
            totalTasks: sql<number>`(
              select count(*)::int from ${tasks}
               where ${tasks.projectId} = ${projects.id})`,
            doneTasks: sql<number>`(
              select count(*)::int from ${tasks}
               where ${tasks.projectId} = ${projects.id}
                 and ${tasks.status} = 'done')`,
            openBlockers: sql<number>`(
              select count(*)::int from ${blockers}
               where ${blockers.projectId} = ${projects.id}
                 and ${blockers.status} <> 'resolved')`,
            loggedHours: sql<string>`(
              select coalesce(sum(${workLogs.hours}),0)::text from ${workLogs}
               where ${workLogs.projectId} = ${projects.id}
                 and ${workLogs.deletedAt} is null)`,
          })
          .from(projects)
          .leftJoin(clients, eq(projects.clientId, clients.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(PAGE_SIZE)
          .offset(offsetFor(list)),
      db
        .select({ n: countRows() })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(where)
        .then((r) => Number(r[0]?.n ?? 0)),
    ]);

  const role = me?.globalRole ?? "developer";

  // Money is fetched separately, never joined: project_financials and
  // work_log_costs are RLS-forced, and a join from this ungated query would
  // return NULLs rather than an error — which reads as "no budget set".
  const moneyByProject = await projectMoneyRows(
    rows.map((r) => r.id),
    role,
  );
  const seesMoney = can(role, "finance.view");

  const info = pageInfo(list, total);

  return (
    <>
      <SectionIntro
        eyebrow="DELIVERY CONTROL"
        title="Projects"
        description={
          scope === null
            ? "Every active project across the agency."
            : "Projects you own or are assigned to."
        }
        actions={
          can(me?.globalRole ?? "developer", "project.create") ? (
            <Link href="/projects/new" className="btn-primary">
              + New project
            </Link>
          ) : undefined
        }
      />

      <ListFilters
        action="/projects"
        params={params}
        active={list}
        placeholder="Project, code or client"
        keepSort={false}
      >
        <div>
          <label className="label" htmlFor="filter-sort">
            Sort by
          </label>
          <select
            id="filter-sort"
            name="sort"
            defaultValue={list.desc ? `-${list.sort}` : (list.sort ?? "name")}
            className="field w-auto min-w-[150px]"
          >
            <option value="name">Name A–Z</option>
            <option value="-name">Name Z–A</option>
            <option value="due">Due soonest</option>
            <option value="-due">Due latest</option>
            <option value="health">Health</option>
          </select>
        </div>
      </ListFilters>

      {/* Sits beside the count rather than inside the filter form: density is a
          preference that persists, not a filter that narrows. */}
      {rows.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-4">
          <span className="text-2xs text-fg-muted">
            {total} project{total === 1 ? "" : "s"}
          </span>
          <DensityToggle current={density} />
        </div>
      )}

      {rows.length === 0 ? (
        list.q ? (
          /* no-results must never be a dead end (r41): the way back out of the
             filter is the action, and the query is quoted so it is obvious what
             was searched. */
          <EmptyState
            variant="no-results"
            title="No Matching Projects"
            action={
              <Link href="/projects" className="btn-secondary btn-sm">
                Clear search
              </Link>
            }
          >
            {`Nothing matches “${list.q}”. Try a project code, a client name, or clear the search to see everything you can access.`}
          </EmptyState>
        ) : (
          <EmptyState
            variant="blank-slate"
            title="No Projects Yet"
            action={
              can(me?.globalRole ?? "developer", "project.create") ? (
                <Link href="/projects/new" className="btn-primary btn-sm">
                  Create project
                </Link>
              ) : undefined
            }
          >
            Projects you own or are assigned to appear here, with hours logged
            against estimate and anything currently blocking them.
          </EmptyState>
        )
      ) : density === "compact" ? (
        /* C4's list mode. §1.1 puts the data zone at 32-40px rows, which the card
           grid cannot be — so this is the same information at that density, with
           the sticky header C4 also asks for. The project is still the first
           column and still human-readable (r16): code and name, never an id. */
        <section className="panel overflow-hidden">
          <div className="max-h-[70vh] w-full overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 z-10 h-[34px] border-b border-border bg-surface px-5 text-left text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                    Project
                  </th>
                  <th scope="col" className="sticky top-0 z-10 h-[34px] w-[180px] border-b border-border bg-surface px-3 text-left text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                    Tasks
                  </th>
                  <th scope="col" className="sticky top-0 z-10 h-[34px] w-[110px] border-b border-border bg-surface px-3 text-right text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                    Logged
                  </th>
                  {seesMoney && (
                    <>
                      <th scope="col" className="sticky top-0 z-10 h-[34px] w-[110px] border-b border-border bg-surface px-3 text-right text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                        Budget
                      </th>
                      <th scope="col" className="sticky top-0 z-10 h-[34px] w-[150px] border-b border-border bg-surface px-3 text-left text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                        Spent
                      </th>
                      <th scope="col" className="sticky top-0 z-10 h-[34px] w-[110px] border-b border-border bg-surface px-3 text-right text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                        Cost
                      </th>
                    </>
                  )}
                  <th scope="col" className="sticky top-0 z-10 h-[34px] w-[130px] border-b border-border bg-surface px-3 text-left text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                    Health
                  </th>
                  <th scope="col" className="sticky top-0 z-10 h-[34px] w-[110px] border-b border-border bg-surface px-5 text-right text-2xs font-bold uppercase tracking-[.1em] text-fg-label">
                    Due
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                    <tr
                      key={p.id}
                      className="h-9 border-b border-border transition-[background-color] duration-150 ease-out-quad last:border-b-0 hover:bg-surface-hover"
                    >
                      <td className="px-5">
                        <Link href={`/projects/${p.id}`} className="flex min-w-0 items-baseline gap-2 font-bold hover:text-brand">
                          <span className="font-mono text-2xs text-fg-muted">{p.code}</span>
                          <span className="truncate">{p.name}</span>
                        </Link>
                        {p.billingModel !== "time_and_materials" && (
                          <span className="ml-2 align-middle">
                            <Badge>
                              {p.billingModel === "retainer" ? "Retainer" : "Fixed fee"}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3">
                        <span className="flex items-center gap-2">
                          <span className="w-[64px]">
                            <BulletBar
                              value={p.doneTasks}
                              target={0}
                              max={p.totalTasks || 1}
                              label={`${p.code} tasks complete`}
                              valueLabel={`${p.doneTasks} of ${p.totalTasks}`}
                              height={4}
                            />
                          </span>
                          <span className="tabular text-2xs text-fg-muted">
                            {p.doneTasks}/{p.totalTasks}
                          </span>
                        </span>
                      </td>
                      <td className="tabular px-3 text-right">
                        {Number(p.loggedHours).toFixed(1)}h
                      </td>
                      {seesMoney && <MoneyCells money={moneyByProject.get(p.id)} logged={p.loggedHours} />}
                      <td className="px-3">
                        <HealthBadge health={p.health} />
                      </td>
                      <td className="tabular px-5 text-right text-fg-muted">
                        {fmtDate(p.internalDueDate)}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const pct =
              p.totalTasks > 0
                ? Math.round((p.doneTasks / p.totalTasks) * 100)
                : 0;
            const atRisk = p.health !== "on_track";

            return (
              <article
                key={p.id}
                className={`panel flex flex-col border-t-[3px] p-5 ${
                  atRisk ? "border-t-brand" : "border-t-transparent"
                }`}
              >
                <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <HealthBadge health={p.health} />
                    {/* What KIND of deal this is. Harvest badges it on the row
                        and Toggl exposes it on the project itself; without it
                        a retainer and a fixed-fee build look identical. */}
                    {p.billingModel !== "time_and_materials" && (
                      <Badge>
                        {p.billingModel === "retainer" ? "Retainer" : "Fixed fee"}
                      </Badge>
                    )}
                  </span>
                  {p.openBlockers > 0 && (
                    <Badge tone="red">
                      {p.openBlockers} blocker{p.openBlockers === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                <p className="eyebrow">
                  {(p.projectType ?? "PROJECT").toUpperCase()}
                </p>
                <h3 className="m-0 text-2xl tracking-[-.04em]">{p.name}</h3>
                <p className="mt-2 min-h-[38px] text-xs text-fg-muted">
                  {p.description ?? p.clientName ?? ""}
                </p>

                <div className="mt-6 flex justify-between text-2xs text-fg-muted">
                  <span>
                    {pct}% complete · {Number(p.loggedHours).toFixed(1)}h logged
                  </span>
                  <span>{fmtDate(p.internalDueDate)}</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${pct}%` }} />
                </div>

                {/* Both density modes carry the same facts: switching layout
                    should change how much fits on screen, never what is true. */}
                {seesMoney && <CardMoney money={moneyByProject.get(p.id)} logged={p.loggedHours} />}

                <div className="mt-6 flex items-center justify-between">
                  <span className="font-mono text-2xs text-fg-subtle">
                    {p.code}
                  </span>
                  <span className="text-2xs text-fg-muted">
                    {p.doneTasks}/{p.totalTasks} tasks
                  </span>
                </div>

                <Link
                  href={`/projects/${p.id}`}
                  className="btn-secondary mt-4 w-full"
                >
                  Open workspace
                </Link>
              </article>
            );
          })}
        </div>
      )}

      {info.pages > 1 && (
        <div className="panel mt-4">
          <Pagination
            info={info}
            pathname="/projects"
            params={params}
            unit="projects"
          />
        </div>
      )}
    </>
  );
}
