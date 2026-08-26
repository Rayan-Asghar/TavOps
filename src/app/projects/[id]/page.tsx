import { notFound, redirect } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
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
import { AppShell } from "@/components/app-shell";
import { HealthBadge, TaskStatusBadge, Badge } from "@/components/badges";
import { LogWorkForm } from "@/components/log-work-form";
import { BlockerForm } from "@/components/blocker-form";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const { id } = await params;

  // 404 rather than 403: a developer probing project ids should not be able to
  // learn which ones exist.
  if (!(await canAccessProject(actor, id))) notFound();

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

  const reporter = { id: users.id, name: users.name };

  // Whether this person sees the whole timesheet feed or only their own
  // entries. Decided before the query so the scoping happens in SQL rather
  // than by filtering rows the page already fetched.
  const role = me?.globalRole ?? "developer";
  const seesAllActivity = can(role, "worklog.viewAll");

  const [taskRows, blockerRows, recentLogs, count] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        estimatedHours: tasks.estimatedHours,
        lastUpdateAt: tasks.lastUpdateAt,
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
        status: blockers.status,
        isUrgent: blockers.isUrgent,
        escalationLevel: blockers.escalationLevel,
        createdAt: blockers.createdAt,
        reportedBy: reporter.name,
      })
      .from(blockers)
      .leftJoin(users, eq(blockers.reportedById, users.id))
      .where(and(eq(blockers.projectId, id), ne(blockers.status, "resolved")))
      .orderBy(desc(blockers.isUrgent), desc(blockers.createdAt)),
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
      .limit(8),
    unresolvedCount(actor.id),
  ]);

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

  const openTasks = taskRows.filter((t) => t.status !== "done");

  return (
    <AppShell userName={me?.name ?? "Unknown"} userRole={role} inboxCount={count}>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
          <HealthBadge health={project.health} />
          <Badge>{project.lifecycle}</Badge>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          <span className="font-mono">{project.code}</span>
          {project.clientName && <> · {project.clientName}</>}
          {project.projectType && <> · {project.projectType}</>}
        </p>
        {project.description && (
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            {project.description}
          </p>
        )}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Internal due" value={fmtDate(project.internalDueDate)} />
        <Stat label="Client due" value={fmtDate(project.clientDueDate)} />
        <Stat label="Open tasks" value={String(openTasks.length)} />
        <Stat
          label="Open blockers"
          value={String(blockerRows.length)}
          tone={blockerRows.length > 0 ? "danger" : undefined}
        />
      </div>

      {finance && (
        <div className="mb-6 card border-warn/30 bg-warn/[0.06] p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Financials</h2>
            <Badge tone="amber">Restricted</Badge>
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-fg-muted">Contract value</div>
              <div className="font-mono text-fg">
                {finance.currency} {finance.contractValue ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-muted">Budgeted hours</div>
              <div className="font-mono text-fg">
                {finance.budgetedHours ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-fg-muted">Platform fee</div>
              <div className="font-mono text-fg">
                {finance.platformFeePct ?? "0"}%
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {blockerRows.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-fg">
                Open blockers
              </h2>
              <ul className="space-y-2">
                {blockerRows.map((b) => (
                  <li key={b.id} className="card p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {b.isUrgent && <Badge tone="red">Urgent</Badge>}
                      <Badge tone={b.ownerSide === "client" ? "amber" : "blue"}>
                        {b.ownerSide === "client" ? "Client dependency" : "Internal"}
                      </Badge>
                      <Badge>{b.category.replace(/_/g, " ")}</Badge>
                      {b.escalationLevel > 0 && (
                        <Badge tone="red">L{b.escalationLevel}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-fg">{b.description}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Reported by {b.reportedBy ?? "unknown"} ·{" "}
                      {fmtDate(b.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-fg">Tasks</h2>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2 text-left">
                  <tr className="text-xs uppercase tracking-wide text-fg-muted">
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Assignee</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 font-medium">Est</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {taskRows.map((t) => (
                    <tr key={t.id} className="hover:bg-surface-2">
                      <td className="px-3 py-2.5 font-medium text-fg">
                        {t.title}
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {t.assigneeName ?? "Unassigned"}
                      </td>
                      <td className="px-3 py-2.5">
                        <TaskStatusBadge status={t.status} />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-fg-muted">
                        {fmtDate(t.dueDate)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-fg-muted">
                        {t.estimatedHours ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-fg">
                {seesAllActivity ? "Recent activity" : "Your activity"}
              </h2>
              <span className="text-xs text-fg-subtle">
                {seesAllActivity
                  ? "everyone on this project"
                  : "only entries you logged"}
              </span>
            </div>
            <ul className="card divide-y divide-border">
              {recentLogs.length === 0 && (
                <li className="p-4 text-sm text-fg-muted">
                  {seesAllActivity
                    ? "Nothing logged yet."
                    : "You have not logged anything on this project yet."}
                </li>
              )}
              {recentLogs.map((l) => (
                <li key={l.id} className="flex gap-3 p-3 text-sm">
                  <span className="font-mono text-xs text-fg-subtle">
                    {fmtDate(l.workDate)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-fg">{l.notes}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {l.userName} · {l.taskTitle ?? "general"} ·{" "}
                      {Number(l.hours).toFixed(2)}h
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          {can(role, "worklog.create") && (
            <LogWorkForm
              projectId={project.id}
              tasks={openTasks.map((t) => ({ id: t.id, title: t.title }))}
            />
          )}
          {can(role, "blocker.create") && (
            <BlockerForm
              projectId={project.id}
              tasks={openTasks.map((t) => ({ id: t.id, title: t.title }))}
            />
          )}
        </aside>
      </div>
    </AppShell>
  );
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
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold ${
          tone === "danger" ? "text-danger" : "text-fg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
