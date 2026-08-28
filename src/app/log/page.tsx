import { redirect } from "next/navigation";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, tasks, users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { QuickLogRow, type QuickLogTask } from "@/components/quick-log";

/**
 * The developer's front door.
 *
 * Everything else in this system is downstream of hours actually being entered,
 * and until now entering them meant opening a laptop, finding the project and
 * scrolling to a form inside a tabbed page — at 1am, at the end of a shift.
 * This is one screen with every open task on it and nothing else.
 *
 * `/` stays the partner view; this is where the people doing the work land.
 */
export default async function LogPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [scope, count] = await Promise.all([
    accessibleProjectIds(actor),
    unresolvedCount(actor.id),
  ]);

  const noAccess = scope !== null && scope.length === 0;

  // Assigned, not finished, on a project that is actually running. Ordered so
  // the thing most likely to be logged is at the top: in-progress first, then
  // by due date.
  const rows = noAccess
    ? []
    : await db
        .select({
          taskId: tasks.id,
          projectId: tasks.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          title: tasks.title,
          status: tasks.status,
          estimatedHours: tasks.estimatedHours,
          loggedHours: sql<string>`(
            select coalesce(sum(${workLogs.hours}),0)::text from ${workLogs}
             where ${workLogs.taskId} = ${tasks.id}
               and ${workLogs.deletedAt} is null)`,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.assigneeId, actor.id),
            ne(tasks.status, "done"),
            ne(projects.lifecycle, "archived"),
            scope === null ? undefined : inArray(tasks.projectId, scope),
          ),
        )
        .orderBy(
          // in_progress sorts before everything else; nulls last on due date.
          sql`case when ${tasks.status} = 'in_progress' then 0 else 1 end`,
          sql`${tasks.dueDate} asc nulls last`,
          asc(tasks.title),
        );

  // Client calls, scoping meetings and internal reviews are real billable work
  // that belongs to no task, so every project the person can see is offered as
  // a "general work" target too.
  const projectRows = noAccess
    ? []
    : await db
        .select({
          id: projects.id,
          code: projects.code,
          name: projects.name,
          clientName: clients.name,
        })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            eq(projects.lifecycle, "active"),
            scope === null ? undefined : inArray(projects.id, scope),
          ),
        )
        .orderBy(asc(projects.name));

  const taskItems: QuickLogTask[] = rows.map((r) => ({
    taskId: r.taskId,
    projectId: r.projectId,
    projectName: r.projectName,
    projectCode: r.projectCode,
    title: r.title,
    status: r.status,
    estimatedHours: r.estimatedHours,
    loggedHours: r.loggedHours,
  }));

  const generalItems: QuickLogTask[] = projectRows.map((p) => ({
    taskId: null,
    projectId: p.id,
    projectName: p.clientName ?? p.name,
    projectCode: p.code,
    title: `General work — ${p.name}`,
    status: "todo",
    estimatedHours: null,
    loggedHours: "0",
  }));

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={me?.globalRole ?? "developer"}
      inboxCount={count}
      title="Log work"
    >
      <SectionIntro
        eyebrow="END OF SHIFT"
        title="Log work"
        description="Your open tasks. Tap one, put in the hours and a line about what you did — that is the whole job."
      />

      {taskItems.length > 0 ? (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <p className="eyebrow">ASSIGNED TO YOU</p>
              <h3 className="m-0 text-[18px] tracking-[-.035em]">Your tasks</h3>
            </div>
            <span className="text-[11px] text-fg-muted">
              {taskItems.length} open
            </span>
          </div>
          <ul>
            {taskItems.map((t) => (
              <QuickLogRow key={t.taskId ?? t.projectId} task={t} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel mb-4 p-12 text-center">
          <p className="m-0 text-[13px] text-fg-muted">
            Nothing is assigned to you right now. Anything else you worked on
            can go under a project below.
          </p>
        </section>
      )}

      {generalItems.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">NO TASK</p>
              <h3 className="m-0 text-[18px] tracking-[-.035em]">
                Calls, meetings, everything else
              </h3>
            </div>
          </div>
          <ul>
            {generalItems.map((p) => (
              <QuickLogRow key={`p-${p.projectId}`} task={p} />
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
