import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, clients, projects, tasks, users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { unresolvedCount } from "@/server/notifications";
import { AppShell } from "@/components/app-shell";
import { HealthBadge, Badge } from "@/components/badges";

export default async function ProjectsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const scope = await accessibleProjectIds(actor);
  const count = await unresolvedCount(actor.id);

  // scope === null means an org-wide role: no restriction to apply.
  const rows =
    scope !== null && scope.length === 0
      ? []
      : await db
          .select({
            id: projects.id,
            code: projects.code,
            name: projects.name,
            health: projects.health,
            lifecycle: projects.lifecycle,
            clientName: clients.name,
            internalDueDate: projects.internalDueDate,
            openBlockers: sql<number>`(
              select count(*)::int from ${blockers}
               where ${blockers.projectId} = ${projects.id}
                 and ${blockers.status} <> 'resolved'
            )`,
            openTasks: sql<number>`(
              select count(*)::int from ${tasks}
               where ${tasks.projectId} = ${projects.id}
                 and ${tasks.status} <> 'done'
            )`,
            loggedHours: sql<string>`(
              select coalesce(sum(${workLogs.hours}), 0)::text from ${workLogs}
               where ${workLogs.projectId} = ${projects.id}
            )`,
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
    >
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Projects</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {rows.length} project{rows.length === 1 ? "" : "s"} you can see.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-fg-muted">
          No projects assigned to you yet.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-left">
              <tr className="text-xs uppercase tracking-wide text-fg-muted">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Health</th>
                <th className="px-4 py-2.5 font-medium">Open</th>
                <th className="px-4 py-2.5 font-medium">Blockers</th>
                <th className="px-4 py-2.5 font-medium">Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium text-fg hover:text-brand"
                    >
                      {p.name}
                    </Link>
                    <div className="font-mono text-xs text-fg-subtle">{p.code}</div>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {p.clientName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <HealthBadge health={p.health} />
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{p.openTasks}</td>
                  <td className="px-4 py-3">
                    {p.openBlockers > 0 ? (
                      <Badge tone="red">{p.openBlockers}</Badge>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                    {Number(p.loggedHours).toFixed(1)}h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
