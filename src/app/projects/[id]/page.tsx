import { notFound, redirect } from "next/navigation";
import { aliasedTable, and, desc, eq, ne, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import {
  blockers,
  clients,
  projectFinancials,
  projects,
  tasks,
  users,
  workLogs,
} from "@/db/schema";
import { getActor } from "@/lib/auth";
import { canAccessProject } from "@/lib/access";
import { can } from "@/lib/rbac";
import { unresolvedCount } from "@/server/notifications";
import { activeSessionFor } from "@/server/timer";
import { activateProject } from "@/server/project-actions";
import { projectMembersFor, assignableStaff } from "@/server/member-queries";
import { AppShell } from "@/components/app-shell";
import { HealthBadge, TaskStatusBadge, Badge } from "@/components/badges";
import { LogWorkForm } from "@/components/log-work-form";
import { BlockerForm } from "@/components/blocker-form";
import { TaskForm } from "@/components/task-form";
import { ReviewForm } from "@/components/review-form";
import { ProjectTeam } from "@/components/project-team";
import {
  ActiveTimerPanel,
  StartTimerButton,
  type ActiveSession,
} from "@/components/task-timer";
import { ProjectTabs, type TabKey } from "@/components/project-tabs";
import { ActionPanel, Disclosure } from "@/components/action-panel";
import { SheetConfig } from "@/components/sheet-config";
import { sheetStatusFor } from "@/server/sheet-queries";

function fmtDate(d: Date | null): string {
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
    : "—";
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-[9px] font-black uppercase tracking-[.12em] text-fg-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 text-[17px] font-extrabold ${
          tone === "danger" ? "text-danger" : "text-fg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

const TAB_KEYS: TabKey[] = ["overview", "tasks", "team", "activity", "sync"];

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const { tab } = await searchParams;

  // 404 rather than 403: a developer probing project ids should not be able to
  // learn which ones exist.
  if (!(await canAccessProject(actor, id))) notFound();

  const requestedTab: TabKey = TAB_KEYS.includes(tab as TabKey)
    ? (tab as TabKey)
    : "overview";

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [project] = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      description: projects.description,
      health: projects.health,
      lifecycle: projects.lifecycle,
      projectType: projects.projectType,
      internalDueDate: projects.internalDueDate,
      clientDueDate: projects.clientDueDate,
      clientName: clients.name,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) notFound();

  const role = me?.globalRole ?? "developer";
  const seesAllActivity = can(role, "worklog.viewAll");
  // The internal date is the delivery buffer. Anyone who cannot see the
  // client-facing date gets the internal one labelled plainly as "Deadline" —
  // naming it "internal" would itself give away that a later date exists.
  const seesClientDeadline = can(role, "deadline.viewClient");
  const canManageMembers = can(role, "project.manageMembers");
  const canConfigureSheet = can(role, "sheet.configure");

  // Falling back rather than rendering an empty pane: someone who types
  // ?tab=sync without the capability should land somewhere useful, not on a
  // blank page that looks broken.
  const activeTab: TabKey =
    requestedTab === "sync" && !canConfigureSheet ? "overview" : requestedTab;

  // Second alias so the reporter and the assignee can be joined in one query.
  const assignee = aliasedTable(users, "assignee");

  const [taskRows, blockerRows, activityRows, teamList, addableStaff, count] =
    await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          dueDate: tasks.dueDate,
          estimatedHours: tasks.estimatedHours,
          assigneeId: tasks.assigneeId,
          assigneeName: users.name,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(eq(tasks.projectId, id))
        .orderBy(tasks.orderIndex, tasks.title),
      db
        .select({
          id: blockers.id,
          description: blockers.description,
          category: blockers.category,
          ownerSide: blockers.ownerSide,
          severity: blockers.severity,
          escalationLevel: blockers.escalationLevel,
          createdAt: blockers.createdAt,
          reportedBy: users.name,
          assignedToName: assignee.name,
        })
        .from(blockers)
        .leftJoin(users, eq(blockers.reportedById, users.id))
        .leftJoin(assignee, eq(blockers.assignedToId, assignee.id))
        .where(and(eq(blockers.projectId, id), ne(blockers.status, "resolved")))
        .orderBy(desc(blockers.severity), desc(blockers.createdAt)),
      db
        .select({
          id: workLogs.id,
          hours: workLogs.hours,
          notes: workLogs.notes,
          workDate: workLogs.workDate,
          userName: users.name,
          taskTitle: tasks.title,
        })
        .from(workLogs)
        .leftJoin(users, eq(workLogs.userId, users.id))
        .leftJoin(tasks, eq(workLogs.taskId, tasks.id))
        .where(
          seesAllActivity
            ? eq(workLogs.projectId, id)
            : and(eq(workLogs.projectId, id), eq(workLogs.userId, actor.id)),
        )
        .orderBy(desc(workLogs.workDate))
        .limit(40),
      projectMembersFor(id),
      canManageMembers ? assignableStaff(id) : Promise.resolve([]),
      unresolvedCount(actor.id),
    ]);

  // Each project has its own client sheet, connected by whichever head runs it.
  const sheetStatus = canConfigureSheet ? await sheetStatusFor(id) : null;

  // Whole-project total, independent of what this person is allowed to read
  // row-by-row — an hours total is not sensitive, individual entries are.
  const [totals] = await db
    .select({ hours: sql<string>`coalesce(sum(${workLogs.hours}),0)::text` })
    .from(workLogs)
    .where(eq(workLogs.projectId, id));

  // Money is fetched only when the role allows it, and only inside the RLS
  // opt-in. Without both, the query returns nothing.
  const finance = can(role, "finance.view")
    ? await withFinanceAccess(async (tx) => {
        const [row] = await tx
          .select()
          .from(projectFinancials)
          .where(eq(projectFinancials.projectId, id))
          .limit(1);
        return row ?? null;
      })
    : null;

  const rawSession = await activeSessionFor(actor.id);
  // Dates cross the server/client boundary as ISO strings.
  const session: ActiveSession | null = rawSession
    ? {
        id: rawSession.id,
        taskId: rawSession.taskId,
        taskTitle: rawSession.taskTitle,
        status: rawSession.status as "running" | "paused",
        accumulatedSeconds: rawSession.accumulatedSeconds,
        resumedAt: rawSession.resumedAt?.toISOString() ?? null,
        startedAt: rawSession.startedAt.toISOString(),
      }
    : null;
  const sessionOnThisProject = rawSession?.projectId === id;

  const openTasks = taskRows.filter((t) => t.status !== "done");
  const doneCount = taskRows.length - openTasks.length;
  const reviewCount = taskRows.filter((t) => t.status === "in_review").length;

  // Tasks can only be assigned to people who are actually on the project —
  // otherwise the assignee cannot open what they were given.
  const assignableMembers = teamList
    .filter((m) => m.role !== "observer")
    .map((m) => ({ id: m.id, name: m.name }));

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={role}
      inboxCount={count}
      title={project.name}
    >
      {project.lifecycle === "draft" && can(role, "project.edit") && (
        <div className="panel mb-4 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-l-warn p-4">
          <div>
            <p className="eyebrow m-0">DRAFT</p>
            <p className="m-0 mt-0.5 text-[12px] text-fg-muted">
              Not active yet. Confirm assets, scope and team, then start the
              clock.
            </p>
          </div>
          <form action={activateProject}>
            <input type="hidden" name="projectId" value={project.id} />
            <button type="submit" className="btn-primary py-2 text-[12px]">
              Set active
            </button>
          </form>
        </div>
      )}

      {/* Compact header. The big display type suits list pages; a dense
          workspace needs the vertical space for content. */}
      <header className="mb-4">
        <p className="eyebrow m-0">
          <span className="font-mono">{project.code}</span>
          {project.clientName && ` · ${project.clientName.toUpperCase()}`}
          {project.projectType && ` · ${project.projectType.toUpperCase()}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-[26px] font-bold tracking-[-.04em]">
            {project.name}
          </h2>
          <HealthBadge health={project.health} />
          <Badge tone="neutral">{project.lifecycle}</Badge>
        </div>
      </header>

      <dl
        className={`mb-4 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 ${
          seesClientDeadline ? "lg:grid-cols-5" : "lg:grid-cols-4"
        }`}
      >
        <Stat
          label={seesClientDeadline ? "Internal due" : "Deadline"}
          value={fmtDate(project.internalDueDate)}
        />
        {/* Not rendered at all rather than hidden with CSS: this is a server
            component, so an unrendered value never reaches the browser. */}
        {seesClientDeadline && (
          <Stat label="Client due" value={fmtDate(project.clientDueDate)} />
        )}
        <Stat label="Tasks done" value={`${doneCount}/${taskRows.length}`} />
        <Stat
          label="Open blockers"
          value={String(blockerRows.length)}
          tone={blockerRows.length > 0 ? "danger" : undefined}
        />
        <Stat label="Hours logged" value={Number(totals?.hours ?? 0).toFixed(1)} />
      </dl>

      {finance && (
        <div className="panel mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-l-[3px] border-l-warn px-5 py-3.5">
          <Badge tone="amber">Restricted</Badge>
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">
              Contract
            </span>
            <strong className="font-mono text-[14px]">
              {finance.currency} {finance.contractValue ?? "—"}
            </strong>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">
              Budgeted
            </span>
            <strong className="font-mono text-[14px]">
              {finance.budgetedHours ?? "—"}h
            </strong>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-wider text-fg-muted">
              Platform fee
            </span>
            <strong className="font-mono text-[14px]">
              {finance.platformFeePct ?? "0"}%
            </strong>
          </div>
        </div>
      )}

      <ProjectTabs
        active={activeTab}
        tabs={[
          { key: "overview", label: "Overview", count: blockerRows.length },
          { key: "tasks", label: "Tasks", count: openTasks.length },
          { key: "team", label: "Team", count: teamList.length },
          { key: "activity", label: "Activity" },
          ...(canConfigureSheet
            ? [
                {
                  key: "sync" as const,
                  label: "Sync",
                  count: sheetStatus?.failed ?? 0,
                },
              ]
            : []),
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          {activeTab === "overview" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">UNRESOLVED</p>
                    <h3 className="m-0 text-[16px] tracking-[-.03em]">
                      Open blockers
                    </h3>
                  </div>
                  {blockerRows.length > 0 && (
                    <Badge tone="red">{blockerRows.length}</Badge>
                  )}
                </div>
                {blockerRows.length === 0 ? (
                  <p className="m-0 px-5 py-8 text-center text-[12px] text-fg-muted">
                    Nothing is blocked.
                  </p>
                ) : (
                  <ul>
                    {blockerRows.map((b) => (
                      <li key={b.id} className="attention-row">
                        <span
                          className={`mt-1.5 signal ${b.ownerSide === "client" ? "bg-[#df9c00]" : "bg-brand"}`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <strong className="block text-[12px]">
                            {b.description}
                          </strong>
                          <span className="mt-1 block text-[9px] text-fg-subtle">
                            {b.reportedBy ?? "unknown"} · {fmtDate(b.createdAt)}
                            {b.assignedToName && (
                              <> · owned by <b>{b.assignedToName}</b></>
                            )}
                          </span>
                        </div>
                        <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto sm:shrink-0 sm:justify-end">
                          {b.severity === "critical" && (
                            <Badge tone="red">Critical</Badge>
                          )}
                          {b.severity === "high" && (
                            <Badge tone="amber">High</Badge>
                          )}
                          <Badge tone={b.ownerSide === "client" ? "amber" : "blue"}>
                            {b.ownerSide === "client" ? "Client" : "Internal"}
                          </Badge>
                          {b.escalationLevel > 0 && (
                            <Badge tone="red">L{b.escalationLevel}</Badge>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {project.description && (
                <section className="panel p-5">
                  <p className="eyebrow">SCOPE</p>
                  <p className="m-0 text-[12px] leading-relaxed text-fg-muted">
                    {project.description}
                  </p>
                </section>
              )}

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">
                      {seesAllActivity ? "LATEST" : "YOUR ENTRIES ONLY"}
                    </p>
                    <h3 className="m-0 text-[16px] tracking-[-.03em]">
                      Recent activity
                    </h3>
                  </div>
                </div>
                <div className="px-5 py-1">
                  {activityRows.length === 0 ? (
                    <p className="py-6 text-[12px] text-fg-muted">
                      Nothing logged yet.
                    </p>
                  ) : (
                    activityRows.slice(0, 3).map((l) => (
                      <div
                        key={l.id}
                        className="grid grid-cols-[14px_1fr] gap-2.5 border-b border-border py-3 last:border-b-0"
                      >
                        <span className="mt-1 h-[7px] w-[7px] rounded-full bg-brand" />
                        <div className="min-w-0">
                          <strong className="text-[11px]">{l.notes}</strong>
                          <p className="m-0 mt-0.5 text-[9px] text-fg-subtle">
                            {fmtDate(l.workDate)} · {l.userName} ·{" "}
                            {Number(l.hours).toFixed(2)}h
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}

          {activeTab === "tasks" && (
            <>
              {can(role, "task.create") && (
                <Disclosure label="+ Add a task">
                  <TaskForm
                    projectId={project.id}
                    members={assignableMembers}
                  />
                </Disclosure>
              )}

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">DELIVERY</p>
                    <h3 className="m-0 text-[16px] tracking-[-.03em]">Tasks</h3>
                  </div>
                  <span className="text-[11px] text-fg-muted">
                    {openTasks.length} open
                    {reviewCount > 0 && ` · ${reviewCount} in review`}
                  </span>
                </div>
                {taskRows.length === 0 ? (
                  <p className="m-0 px-5 py-10 text-center text-[12px] text-fg-muted">
                    No tasks yet.
                  </p>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead>
                        <tr>
                          {["Task", "Assignee", "Status", "Due", "Est", ""].map(
                            (h) => (
                              <th
                                key={h || "actions"}
                                className="h-[40px] border-b border-border px-4 text-left text-[8px] font-black uppercase tracking-[.12em] text-fg-muted"
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {taskRows.map((t) => (
                          <tr
                            key={t.id}
                            className="border-b border-border last:border-b-0 hover:bg-[#fafaf8]"
                          >
                            <td className="h-[58px] px-4 text-[11px] font-bold">
                              {t.title}
                            </td>
                            <td className="px-4 text-[11px] text-fg-muted">
                              {t.assigneeName ?? "Unassigned"}
                            </td>
                            <td className="px-4">
                              <TaskStatusBadge status={t.status} />
                            </td>
                            <td className="px-4 font-mono text-[9px] text-fg-muted">
                              {fmtDate(t.dueDate)}
                            </td>
                            <td className="px-4 font-mono text-[9px] text-fg-muted">
                              {t.estimatedHours ?? "—"}
                            </td>
                            <td className="px-4 text-right">
                              {t.status === "in_review" &&
                              can(role, "review.approve") ? (
                                <div className="flex justify-end">
                                  <ReviewForm taskId={t.id} compact />
                                </div>
                              ) : null}
                              {/* You can only time your own work, or pick up
                                  something nobody is assigned. Timing a
                                  colleague's task would put their hours under
                                  your name. */}
                              {t.status !== "in_review" &&
                                t.status !== "done" &&
                                can(role, "worklog.create") &&
                                (t.assigneeId === actor.id ||
                                  t.assigneeId === null) &&
                                session?.taskId !== t.id && (
                                  <StartTimerButton
                                    taskId={t.id}
                                    disabled={!!session}
                                    label={
                                      t.assigneeId === null ? "Pick up" : "Start"
                                    }
                                  />
                                )}
                              {session?.taskId === t.id && (
                                <span className="text-[9px] font-bold text-brand">
                                  TIMING
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === "sync" && canConfigureSheet && sheetStatus && (
            <SheetConfig
              projectId={project.id}
              status={sheetStatus}
              serviceAccountEmail={
                process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null
              }
            />
          )}

          {activeTab === "team" && (
            <ProjectTeam
              projectId={project.id}
              members={teamList}
              assignable={addableStaff}
              canManage={canManageMembers}
            />
          )}

          {activeTab === "activity" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">
                    {seesAllActivity
                      ? "EVERYONE ON THIS PROJECT"
                      : "ONLY ENTRIES YOU LOGGED"}
                  </p>
                  <h3 className="m-0 text-[16px] tracking-[-.03em]">
                    {seesAllActivity ? "Activity" : "Your activity"}
                  </h3>
                </div>
                <span className="text-[11px] text-fg-muted">
                  {activityRows.length} entr
                  {activityRows.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="px-5 py-1">
                {activityRows.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-fg-muted">
                    {seesAllActivity
                      ? "Nothing logged yet."
                      : "You have not logged anything on this project yet."}
                  </p>
                ) : (
                  activityRows.map((l) => (
                    <div
                      key={l.id}
                      className="grid grid-cols-[14px_1fr] gap-2.5 border-b border-border py-3.5 last:border-b-0"
                    >
                      <span className="mt-1 h-[7px] w-[7px] rounded-full bg-brand" />
                      <div className="min-w-0">
                        <strong className="text-[11px]">{l.notes}</strong>
                        <p className="m-0 mt-1 text-[10px] text-fg-muted">
                          {l.taskTitle ?? "General project work"} ·{" "}
                          {Number(l.hours).toFixed(2)}h
                        </p>
                        <small className="text-[9px] text-fg-subtle">
                          {fmtDate(l.workDate)} · {l.userName}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </div>

        {/* The rail stays constant across tabs: what you are looking at should
            not change what you can do. */}
        <aside className="space-y-3">
          {session && sessionOnThisProject && (
            <ActiveTimerPanel session={session} />
          )}
          {session && !sessionOnThisProject && (
            <div className="panel border-l-[3px] border-l-warn p-4">
              <p className="eyebrow m-0">TIMER RUNNING ELSEWHERE</p>
              <p className="m-0 mt-1 text-[11px] text-fg-muted">
                You are timing &ldquo;{session.taskTitle}&rdquo; on another
                project. Finish it before starting one here.
              </p>
            </div>
          )}

          <ActionPanel
            logWork={
              can(role, "worklog.create") ? (
                <LogWorkForm
                  projectId={project.id}
                  tasks={openTasks.map((t) => ({ id: t.id, title: t.title }))}
                />
              ) : null
            }
            reportBlocker={
              can(role, "blocker.create") ? (
                <BlockerForm
                  projectId={project.id}
                  tasks={openTasks.map((t) => ({ id: t.id, title: t.title }))}
                  members={assignableMembers.filter((m) => m.id !== actor.id)}
                />
              ) : null
            }
          />
        </aside>
      </div>
    </AppShell>
  );
}
