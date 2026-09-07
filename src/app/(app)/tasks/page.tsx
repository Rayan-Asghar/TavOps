import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { PageHeader, SummaryStrip } from "@/components/app-shell";
import { DataTable, EmptyState, Pagination, Td, Th, TRow } from "@/components/ui";
import { Badge } from "@/components/badges";
import { TASK_TONE } from "@/lib/tone";
import { taskFilterOptions, taskList } from "@/server/task-queries";
import { viewsFor } from "@/server/saved-view-queries";
import { SavedViews } from "@/components/saved-views";
import { normaliseViewQuery } from "@/lib/saved-view";
import { fmtDate, hrs } from "@/lib/format";
import {
  offsetFor,
  pageInfo,
  parseListParams,
  type RawParams,
} from "@/lib/list-params";

export const metadata = { title: "Tasks" };

const SORTABLE = ["due", "project", "status"] as const;
const PAGE_SIZE = 40;
const STATUSES = ["todo", "in_progress", "blocked", "in_review", "done"];

/**
 * Every task you can reach, in one list.
 *
 * Tasks were previously reachable only inside the project that owned them, so
 * "what is assigned to me across everything" and "what is sitting in review"
 * had no screen at all — the two questions a delivery lead asks most.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const params = await searchParams;
  const list = parseListParams(params, {
    sortable: SORTABLE,
    pageSize: PAGE_SIZE,
  });

  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const status = STATUSES.includes(one(params.status)) ? one(params.status) : null;
  const assigneeId = one(params.assignee) || null;
  const projectId = one(params.project) || null;
  // Open-only by default: a list that opens on every task ever closed is a
  // history, not a working queue. `?open=all` is the way out.
  const openOnly = one(params.open) !== "all" && status !== "done";

  const scope = await accessibleProjectIds(actor);
  const filters = { q: list.q, status, assigneeId, projectId, openOnly };

  const [{ rows, total }, options] = await Promise.all([
    taskList(scope, filters, {
      limit: PAGE_SIZE,
      offset: offsetFor(list),
      sort: list.sort,
      desc: list.desc,
    }),
    taskFilterOptions(scope),
  ]);

  const info = pageInfo(list, total);

  // The query as rendered, so "save this view" stores exactly what is on
  // screen — normalised, so the same filters always produce the same string.
  const currentQuery = normaliseViewQuery(
    new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) =>
        v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]],
      ),
    ).toString(),
  );
  const views = await viewsFor("/tasks", actor.id);
  const unassigned = rows.filter((r) => !r.assigneeName).length;
  const estimated = rows.reduce((s, r) => s + Number(r.estimatedHours ?? 0), 0);
  const logged = rows.reduce((s, r) => s + Number(r.loggedHours), 0);

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Tasks"
        description="Every task on every project you can reach."
        summary={
          <SummaryStrip
            figures={[
              { label: openOnly ? "Open tasks" : "Tasks", value: String(total) },
              { label: "Unassigned", value: String(unassigned) },
              { label: "Estimated", value: `${hrs(estimated)}h` },
              { label: "Logged", value: `${hrs(logged)}h` },
            ]}
          />
        }
        controls={
          /* GET, so a filtered list is a shareable URL — the same rule the rest
             of the app follows, and what makes a saved view just a saved link. */
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input
              name="q"
              defaultValue={list.q}
              placeholder="Task, project or code"
              aria-label="Search tasks"
              className="field h-11 w-[200px] py-0"
            />
            <select
              name="status"
              defaultValue={status ?? ""}
              aria-label="Status"
              className="field h-11 py-0"
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select
              name="assignee"
              defaultValue={assigneeId ?? ""}
              aria-label="Assignee"
              className="field h-11 py-0"
            >
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {options.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              name="project"
              defaultValue={projectId ?? ""}
              aria-label="Project"
              className="field h-11 py-0"
            >
              <option value="">All projects</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <select
              name="open"
              defaultValue={one(params.open) || "open"}
              aria-label="Include done"
              className="field h-11 py-0"
            >
              <option value="open">Open only</option>
              <option value="all">Include done</option>
            </select>
            <button type="submit" className="btn-secondary btn-sm">
              Apply
            </button>
          </form>
        }
      />

      <div className="mb-4">
        <SavedViews path="/tasks" currentQuery={currentQuery} views={views} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          variant={list.q || status || assigneeId || projectId ? "no-results" : "blank-slate"}
          title={list.q || status || assigneeId || projectId ? "Nothing matches" : "No Tasks Yet"}
          action={
            <Link href="/tasks" className="btn-secondary btn-sm">
              Clear filters
            </Link>
          }
        >
          Tasks appear here from every project you can reach. Narrow by person,
          project or status.
        </EmptyState>
      ) : (
        <>
          <DataTable maxHeight={640}>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Project</Th>
                <Th>Assignee</Th>
                <Th>Status</Th>
                <Th numeric>Est</Th>
                <Th numeric>Logged</Th>
                <Th numeric>Due</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const over =
                  t.estimatedHours !== null &&
                  Number(t.loggedHours) > Number(t.estimatedHours);
                return (
                  <TRow key={t.id}>
                    <Td>
                      <Link
                        href={`/projects/${t.projectId}?tab=tasks`}
                        className="font-bold hover:text-brand"
                      >
                        {t.title}
                      </Link>
                      {t.taskTypeName && (
                        <span className="ml-2 text-2xs text-fg-subtle">
                          {t.taskTypeName}
                          {t.billable === false && " · non-billable"}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/projects/${t.projectId}`}
                        className="hover:text-brand"
                      >
                        <span className="font-mono text-2xs text-fg-muted">
                          {t.projectCode}
                        </span>
                      </Link>
                      {t.clientName && (
                        <span className="ml-2 text-2xs text-fg-subtle">
                          {t.clientName}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {t.assigneeName ?? (
                        <span className="text-warn">Unassigned</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={TASK_TONE[t.status] ?? "neutral"}>
                        {t.status.replace(/_/g, " ")}
                      </Badge>
                    </Td>
                    <Td numeric>
                      {t.estimatedHours ? `${hrs(Number(t.estimatedHours))}h` : "—"}
                    </Td>
                    <Td numeric>
                      <span className={over ? "font-bold text-danger" : ""}>
                        {hrs(Number(t.loggedHours))}h
                      </span>
                    </Td>
                    <Td numeric>{fmtDate(t.dueDate)}</Td>
                  </TRow>
                );
              })}
            </tbody>
          </DataTable>

          {info.pages > 1 && (
            <div className="panel mt-4">
              <Pagination info={info} pathname="/tasks" params={params} />
            </div>
          )}
        </>
      )}
    </>
  );
}
