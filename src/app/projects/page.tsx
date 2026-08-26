import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, clients, projects, tasks, users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { HealthBadge, Badge } from "@/components/badges";

function fmtDate(d: Date | null): string {
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
    : "—";
}

export default async function ProjectsPage() {
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

  const rows =
    scope !== null && scope.length === 0
      ? []
      : await db
          .select({
            id: projects.id,
            code: projects.code,
            name: projects.name,
            description: projects.description,
            projectType: projects.projectType,
            health: projects.health,
            lifecycle: projects.lifecycle,
            clientName: clients.name,
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
               where ${workLogs.projectId} = ${projects.id})`,
          })
          .from(projects)
          .leftJoin(clients, eq(projects.clientId, clients.id))
          .where(
            and(
              ne(projects.lifecycle, "archived"),
              scope === null ? sql`true` : inArray(projects.id, scope),
            ),
          )
          .orderBy(projects.name);

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={me?.globalRole ?? "developer"}
      inboxCount={count}
      title="Projects"
    >
      <SectionIntro
        eyebrow="DELIVERY CONTROL"
        title="Projects"
        description={
          scope === null
            ? "Every active project across the agency."
            : "Projects you own or are assigned to."
        }
      />

      {rows.length === 0 ? (
        <div className="panel p-12 text-center text-[13px] text-fg-muted">
          No projects assigned to you yet.
        </div>
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
                <div className="mb-6 flex items-center justify-between">
                  <HealthBadge health={p.health} />
                  {p.openBlockers > 0 && (
                    <Badge tone="red">
                      {p.openBlockers} blocker{p.openBlockers === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                <p className="eyebrow">
                  {(p.projectType ?? "PROJECT").toUpperCase()}
                </p>
                <h3 className="m-0 text-[20px] tracking-[-.04em]">{p.name}</h3>
                <p className="mt-2 min-h-[38px] text-[10px] text-fg-muted">
                  {p.description ?? p.clientName ?? ""}
                </p>

                <div className="mt-6 flex justify-between text-[9px] text-fg-muted">
                  <span>
                    {pct}% complete · {Number(p.loggedHours).toFixed(1)}h logged
                  </span>
                  <span>{fmtDate(p.internalDueDate)}</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${pct}%` }} />
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <span className="font-mono text-[9px] text-fg-subtle">
                    {p.code}
                  </span>
                  <span className="text-[9px] text-fg-muted">
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
    </AppShell>
  );
}
