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
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
    : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-3.5">
      <dt className="text-[9px] text-fg-muted">{label}</dt>
      <dd className="m-0 mt-1 text-[15px] font-extrabold">{value}</dd>
    </div>
  );
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
        isUrgent: blockers.isUrgent,
        escalationLevel: blockers.escalationLevel,
        createdAt: blockers.createdAt,
        reportedBy: users.name,
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
  const doneCount = taskRows.length - openTasks.length;
  const totalHours = recentLogs.reduce((s, l) => s + Number(l.hours), 0);

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={role}
      inboxCount={count}
      title={project.name}
    >
      <div className="mb-7 mt-3.5 border-b border-fg pb-6 pt-6">
        <p className="eyebrow">
          {(project.projectType ?? "PROJECT").toUpperCase()}
          {project.clientName && ` · ${project.clientName.toUpperCase()}`}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="display m-0 text-[clamp(28px,4vw,48px)]">
            {project.name}
          </h2>
          <HealthBadge health={project.health} />
          <Badge tone="neutral">{project.lifecycle}</Badge>
        </div>
        {project.description && (
          <p className="mt-3 max-w-[560px] text-[12px] text-fg-muted">
            {project.description}
          </p>
        )}
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-px border border-border bg-border lg:grid-cols-5">
        <Stat label="Internal deadline" value={fmtDate(project.internalDueDate)} />
        <Stat label="Client deadline" value={fmtDate(project.clientDueDate)} />
        <Stat label="Tasks done" value={`${doneCount}/${taskRows.length}`} />
        <Stat label="Open blockers" value={String(blockerRows.length)} />
        <Stat label="Code" value={project.code} />
      </dl>

      {finance && (
        <section className="panel mb-4 border-l-[3px] border-l-warn p-5">
          <div className="mb-3 flex items-center gap-2">
            <p className="eyebrow m-0">RESTRICTED</p>
            <Badge tone="amber">Commercial data</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <span className="text-[9px] text-fg-muted">Contract value</span>
              <strong className="mt-1 block font-mono text-[18px]">
                {finance.currency} {finance.contractValue ?? "—"}
              </strong>
            </div>
            <div>
              <span className="text-[9px] text-fg-muted">Budgeted hours</span>
              <strong className="mt-1 block font-mono text-[18px]">
                {finance.budgetedHours ?? "—"}
              </strong>
            </div>
            <div>
              <span className="text-[9px] text-fg-muted">Platform fee</span>
              <strong className="mt-1 block font-mono text-[18px]">
                {finance.platformFeePct ?? "0"}%
              </strong>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {blockerRows.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">UNRESOLVED</p>
                  <h3 className="m-0 text-[18px] tracking-[-.035em]">
                    Open blockers
                  </h3>
                </div>
                <Badge tone="red">{blockerRows.length}</Badge>
              </div>
              <ul>
                {blockerRows.map((b) => (
                  <li key={b.id} className="attention-row">
                    <span
                      className={`signal ${b.ownerSide === "client" ? "bg-[#df9c00]" : "bg-brand"}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <strong className="block text-[12px]">
                        {b.description}
                      </strong>
                      <span className="mt-1 block text-[9px] text-fg-subtle">
                        Reported by {b.reportedBy ?? "unknown"} ·{" "}
                        {fmtDate(b.createdAt)}
                      </span>
                    </div>
                    <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto sm:shrink-0 sm:justify-end">
                      {b.isUrgent && <Badge tone="red">Urgent</Badge>}
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
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">DELIVERY</p>
                <h3 className="m-0 text-[18px] tracking-[-.035em]">Tasks</h3>
              </div>
              <span className="text-[11px] text-fg-muted">
                {openTasks.length} open
              </span>
            </div>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr>
                    {["Task", "Assignee", "Status", "Due", "Est"].map((h) => (
                      <th
                        key={h}
                        className="h-[42px] border-b border-border px-4 text-left text-[8px] font-black uppercase tracking-[.12em] text-fg-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {taskRows.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border last:border-b-0 hover:bg-[#fafaf8]"
                    >
                      <td className="h-[62px] px-4 text-[11px] font-bold">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">
                  {seesAllActivity ? "LIVE HISTORY" : "YOUR ENTRIES ONLY"}
                </p>
                <h3 className="m-0 text-[18px] tracking-[-.035em]">
                  {seesAllActivity ? "Recent activity" : "Your activity"}
                </h3>
              </div>
              <span className="text-[11px] text-fg-muted">
                {totalHours.toFixed(2)}h shown
              </span>
            </div>
            <div className="px-5 py-1">
              {recentLogs.length === 0 && (
                <p className="py-6 text-[12px] text-fg-muted">
                  {seesAllActivity
                    ? "Nothing logged yet."
                    : "You have not logged anything on this project yet."}
                </p>
              )}
              {recentLogs.map((l) => (
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
              ))}
            </div>
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
