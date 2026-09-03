import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { canAccessProject, projectRoleOf } from "@/lib/access";
import { can, canInProject } from "@/lib/rbac";
import { activeSessionFor } from "@/server/timer";
import { loadProjectDetail, projectTitle } from "@/server/project-queries";
import { activateProject } from "@/server/project-actions";
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
import { SheetPanel } from "@/components/sheet-panel";
import { sheetStatusFor } from "@/server/sheet-queries";
import { templateCopyUrl } from "@/lib/sheet-template";
import { ProjectActivity } from "@/components/project-activity";
import { ActionPanel, Disclosure } from "@/components/action-panel";
import { CopyBlock } from "@/components/copy-field";
import { renderClientBrief, type ClientBrief } from "@/lib/client-brief";


import { fmtDate } from "@/lib/format";
import { ActionButton, DataTable, EmptyRow, Th } from "@/components/ui";

/**
 * The one route where a dynamic tab title earns its keep — people keep several
 * projects open at once.
 *
 * Runs the same access check as the page rather than trusting the id: without
 * it, a title would confirm that a project exists, and to whom, which is
 * exactly what the page's notFound() is there to prevent.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const actor = await getActor();
  if (!actor) return { title: "Project" };

  const { id } = await params;
  if (!(await canAccessProject(actor, id))) return { title: "Project" };

  const row = await projectTitle(id);
  return { title: row ? `${row.code} ${row.name}` : "Project" };
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
  // A <div> inside a <dl> is only valid as a wrapper around dt/dd pairs, which
  // is what this now is. It used to be divs all the way down, so the list
  // announced as a definition list with no terms in it.
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-2xs font-bold uppercase tracking-[.12em] text-fg-muted">
        {label}
      </dt>
      <dd
        className={`m-0 mt-0.5 text-xl font-bold ${
          tone === "danger" ? "text-danger" : "text-fg"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

const TAB_KEYS: TabKey[] = ["overview", "tasks", "team", "activity", "sheet"];

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

  const data = await loadProjectDetail(actor, id);
  if (!data) notFound();

  const {
    me,
    role,
    project,
    taskRows,
    blockerRows,
    activityRows,
    teamList,
    addableStaff,
    inboxCount: count,
    totals,
    finance,
    seesAllActivity,
    canManageMembers,
  } = data;

  // The internal date is the delivery buffer. Anyone who cannot see the
  // client-facing date gets the internal one labelled plainly as "Deadline" —
  // naming it "internal" would itself give away that a later date exists.
  const seesClientDeadline = can(role, "deadline.viewClient");

  // The same capability gates the client brief. `deadline.viewClient` already
  // means "this person deals with the client" — admin, head and sales — so
  // reusing it keeps one answer to that question instead of two that can drift.
  const brief: ClientBrief | null = seesClientDeadline
    ? {
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        tasksDone: taskRows.filter((t) => t.status === "done").length,
        tasksTotal: taskRows.length,
        tasksInReview: taskRows.filter((t) => t.status === "in_review").length,
        clientDueDate: project.clientDueDate,
        waitingOnClient: blockerRows
          .filter((b) => b.ownerSide === "client")
          .map((b) => b.description),
        // `sql<Date>` is an assertion, not a conversion — drizzle cannot map a
        // bare max(), so postgres-js may hand back a string. Coerced the same
        // way digest.ts does it.
        lastMovementAt: totals?.lastMovementAt
          ? new Date(totals.lastMovementAt)
          : null,
      }
    : null;
  // Your own entries are always yours to fix; anyone else's needs the grant.
  const canEditOthersWork = can(role, "worklog.edit");
  // Attaching a sheet belongs to whoever runs the project, so a developer who
  // types ?tab=sheet lands somewhere useful rather than on a blank pane.
  const canConfigureSheet = canInProject(
    role,
    await projectRoleOf(actor, id),
    "sheet.configure",
  );
  const activeTab: TabKey =
    requestedTab === "sheet" && !canConfigureSheet ? "overview" : requestedTab;

  const sheetStatus = canConfigureSheet
    ? await sheetStatusFor({ projectId: id })
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
      parent={{ label: "Projects", href: "/projects" }}
      userName={me?.name ?? "Unknown"}
      userRole={role}
      inboxCount={count}
      title={project.name}
    >
      {project.lifecycle === "draft" && can(role, "project.edit") && (
        <div className="panel mb-4 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-l-warn p-4">
          <div>
            <p className="eyebrow m-0">DRAFT</p>
            <p className="m-0 mt-0.5 text-xs text-fg-muted">
              Not active yet. Confirm assets, scope and team, then start the
              clock.
            </p>
          </div>
          <ActionButton
            action={activateProject}
            fields={{ projectId: project.id }}
            className="btn-primary btn-sm"
            pendingLabel="Activating…"
          >
            Set active
          </ActionButton>
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
          <h1 className="m-0 text-3xl font-bold tracking-[-.04em]">
            {project.name}
          </h1>
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
            <span className="text-2xs uppercase tracking-wider text-fg-muted">
              Contract
            </span>
            <strong className="font-mono text-base">
              {finance.currency} {finance.contractValue ?? "—"}
            </strong>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xs uppercase tracking-wider text-fg-muted">
              Budgeted
            </span>
            <strong className="font-mono text-base">
              {finance.budgetedHours ?? "—"}h
            </strong>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xs uppercase tracking-wider text-fg-muted">
              Platform fee
            </span>
            <strong className="font-mono text-base">
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
                  key: "sheet" as const,
                  label: "Sheet",
                  count: sheetStatus?.failed ?? 0,
                },
              ]
            : []),
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          {activeTab === "overview" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">UNRESOLVED</p>
                    <h3 className="m-0 text-lg tracking-[-.03em]">
                      Open blockers
                    </h3>
                  </div>
                  {blockerRows.length > 0 && (
                    <Badge tone="red">{blockerRows.length}</Badge>
                  )}
                </div>
                {blockerRows.length === 0 ? (
                  <EmptyRow>Nothing is blocked.</EmptyRow>
                ) : (
                  <ul>
                    {blockerRows.map((b) => (
                      <li key={b.id} className="attention-row">
                        <span
                          className={`mt-1.5 signal ${b.ownerSide === "client" ? "bg-signal-warn" : "bg-brand"}`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <strong className="block text-xs">
                            {b.description}
                          </strong>
                          <span className="mt-1 block text-2xs text-fg-subtle">
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

              {brief && (
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">FOR THE CLIENT</p>
                      <h3 className="m-0 text-lg tracking-[-.03em]">
                        Where this stands
                      </h3>
                      <p className="m-0 mt-1 text-xs text-fg-muted">
                        Safe to send as written. No hours, no internal notes and
                        no internal date — the target below is the client&apos;s.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Stat
                        label="Done"
                        value={
                          brief.tasksTotal > 0
                            ? `${brief.tasksDone}/${brief.tasksTotal}`
                            : "—"
                        }
                      />
                      <Stat label="In review" value={String(brief.tasksInReview)} />
                      <Stat
                        label="Target date"
                        value={
                          brief.clientDueDate ? fmtDate(brief.clientDueDate) : "—"
                        }
                      />
                      <Stat
                        label="Last movement"
                        value={
                          brief.lastMovementAt
                            ? fmtDate(brief.lastMovementAt)
                            : "—"
                        }
                      />
                    </div>

                    {brief.waitingOnClient.length > 0 && (
                      <div>
                        <p className="eyebrow">WAITING ON THE CLIENT</p>
                        <ul className="m-0 mt-2 space-y-1 pl-4">
                          {brief.waitingOnClient.map((w) => (
                            <li key={w} className="list-disc text-xs text-fg">
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rendered from the same function as the panel above, so
                        what a rep pastes can never drift from what they read. */}
                    <CopyBlock
                      value={renderClientBrief(brief)}
                      label="Paste into an email or a chat"
                      buttonLabel="Copy brief"
                    />
                  </div>
                </section>
              )}

              {project.description && (
                <section className="panel p-5">
                  <p className="eyebrow">SCOPE</p>
                  <p className="m-0 text-xs leading-relaxed text-fg-muted">
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
                    <h3 className="m-0 text-lg tracking-[-.03em]">
                      Recent activity
                    </h3>
                  </div>
                </div>
                <div className="px-5 py-1">
                  {activityRows.length === 0 ? (
                    <p className="py-6 text-xs text-fg-muted">
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
                          <strong className="text-xs">{l.notes}</strong>
                          <p className="m-0 mt-0.5 text-2xs text-fg-subtle">
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
                    <h3 className="m-0 text-lg tracking-[-.03em]">Tasks</h3>
                  </div>
                  <span className="text-xs text-fg-muted">
                    {openTasks.length} open
                    {reviewCount > 0 && ` · ${reviewCount} in review`}
                  </span>
                </div>
                {taskRows.length === 0 ? (
                  <EmptyRow>No tasks yet.</EmptyRow>
                ) : (
                  <DataTable minWidth={640}>
                      <thead>
                        <tr>
                          <Th>Task</Th>
                          <Th>Assignee</Th>
                          <Th>Status</Th>
                          <Th>Due</Th>
                          <Th>Est</Th>
                          {/* Named for screen readers; an unnamed <th> is a hole
                              in the header row. */}
                          <Th srOnly>Actions</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskRows.map((t) => (
                          <tr
                            key={t.id}
                            className="border-b border-border last:border-b-0 hover:bg-surface-hover"
                          >
                            <td className="h-[58px] px-4 text-xs font-bold">
                              {t.title}
                            </td>
                            <td className="px-4 text-xs text-fg-muted">
                              {t.assigneeName ?? "Unassigned"}
                            </td>
                            <td className="px-4">
                              <TaskStatusBadge status={t.status} />
                            </td>
                            <td className="px-4 font-mono text-2xs text-fg-muted">
                              {fmtDate(t.dueDate)}
                            </td>
                            <td className="px-4 font-mono text-2xs text-fg-muted">
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
                                    blockedReason="Finish your running timer first"
                                    label={
                                      t.assigneeId === null ? "Pick up" : "Start"
                                    }
                                  />
                                )}
                              {session?.taskId === t.id && (
                                <span className="text-2xs font-bold text-brand">
                                  TIMING
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                )}
              </section>
            </>
          )}

          {activeTab === "team" && (
            <ProjectTeam
              projectId={project.id}
              members={teamList}
              assignable={addableStaff}
              canManage={canManageMembers}
            />
          )}

          {activeTab === "sheet" && canConfigureSheet && sheetStatus && (
            <SheetPanel
              projectId={project.id}
              projectLabel={`${project.code} — ${project.name}`}
              status={sheetStatus}
              serviceAccountEmail={
                process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null
              }
              templateCopyHref={
                process.env.TAVREN_SHEET_TEMPLATE_ID
                  ? templateCopyUrl(process.env.TAVREN_SHEET_TEMPLATE_ID)
                  : null
              }
            />
          )}

          {activeTab === "activity" && (
            <ProjectActivity
              rows={activityRows}
              seesAllActivity={seesAllActivity}
              canEditOthersWork={canEditOthersWork}
              actorId={actor.id}
            />
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
              <p className="m-0 mt-1 text-xs text-fg-muted">
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
