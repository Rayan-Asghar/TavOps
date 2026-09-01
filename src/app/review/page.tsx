import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { aliasedTable, and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, reviews, tasks, users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { Badge, MetricCard, MetricGrid } from "@/components/badges";
import { ReviewForm } from "@/components/review-form";


import { timeAgo } from "@/lib/format";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Review queue" };
export default async function ReviewPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "review.approve")) notFound();

  const [scope, count] = await Promise.all([
    accessibleProjectIds(actor),
    unresolvedCount(actor.id),
  ]);

  const assignee = aliasedTable(users, "assignee");

  const queue =
    scope !== null && scope.length === 0
      ? []
      : await db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            projectId: tasks.projectId,
            projectName: projects.name,
            clientName: clients.name,
            estimatedHours: tasks.estimatedHours,
            lastUpdateAt: tasks.lastUpdateAt,
            assigneeName: assignee.name,
            // Rounds already spent on this task: a fourth-time submission
            // deserves a different kind of attention to a first.
            priorRounds: sql<number>`(
              select count(*)::int from ${reviews}
               where ${reviews.taskId} = ${tasks.id})`,
            loggedHours: sql<string>`(
              select coalesce(sum(${workLogs.hours}),0)::text from ${workLogs}
               where ${workLogs.taskId} = ${tasks.id}
                 and ${workLogs.deletedAt} is null)`,
            lastNote: sql<string | null>`(
              select ${workLogs.internalNotes} from ${workLogs}
               where ${workLogs.taskId} = ${tasks.id}
                 and ${workLogs.deletedAt} is null
               order by ${workLogs.workDate} desc limit 1)`,
          })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .leftJoin(clients, eq(projects.clientId, clients.id))
          .leftJoin(assignee, eq(tasks.assigneeId, assignee.id))
          .where(
            and(
              eq(tasks.status, "in_review"),
              scope === null ? sql`true` : inArray(tasks.projectId, scope),
            ),
          )
          .orderBy(tasks.lastUpdateAt);

  const [recent] = await db
    .select({
      approved: sql<number>`count(*) filter (where ${reviews.decision} = 'approved')::int`,
      sentBack: sql<number>`count(*) filter (where ${reviews.decision} = 'revision_needed')::int`,
    })
    .from(reviews)
    .where(eq(reviews.reviewerId, actor.id));

  const total = (recent?.approved ?? 0) + (recent?.sentBack ?? 0);
  const firstPass = total ? ((recent?.approved ?? 0) / total) * 100 : 0;

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={role}
      inboxCount={count}
      title="Review queue"
    >
      <SectionIntro
        eyebrow="QUALITY GATE"
        title="Review queue"
        description="Work submitted and waiting on you. Approving finishes the task; sending it back returns it with a reason."
      />

      <MetricGrid>
        <MetricCard
          label="Waiting on you"
          value={String(queue.length)}
          note="Submitted and not yet reviewed."
        />
        <MetricCard
          label="Repeat rounds"
          value={String(queue.filter((q) => q.priorRounds > 0).length)}
          note="Already sent back at least once."
        />
        <MetricCard
          label="You approved"
          value={String(recent?.approved ?? 0)}
          note="All time."
        />
        <MetricCard
          label="First-pass rate"
          value={total ? `${firstPass.toFixed(0)}%` : "—"}
          accent
          note="Approved without a revision round."
        />
      </MetricGrid>

      {queue.length === 0 ? (
        <EmptyState>Nothing waiting for review. When a developer marks work ready, it
            lands here.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {queue.map((t) => (
            <li key={t.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <strong className="text-base">{t.title}</strong>
                    {t.priorRounds > 0 && (
                      <Badge tone="amber">
                        Round {t.priorRounds + 1}
                      </Badge>
                    )}
                  </div>
                  <p className="m-0 text-xs text-fg-muted">
                    <Link
                      href={`/projects/${t.projectId}`}
                      className="font-bold hover:text-brand"
                    >
                      {t.projectName}
                    </Link>
                    {t.clientName && ` · ${t.clientName}`} · {t.assigneeName ?? "Unassigned"} ·{" "}
                    {Number(t.loggedHours).toFixed(2)}h logged
                    {t.estimatedHours && ` of ${t.estimatedHours} est`} ·
                    submitted {timeAgo(t.lastUpdateAt)}
                  </p>

                  {t.lastNote && (
                    <div className="mt-3 border-l-2 border-border pl-3">
                      <p className="eyebrow m-0">WHAT THEY SAID</p>
                      <p className="m-0 mt-0.5 text-xs">{t.lastNote}</p>
                    </div>
                  )}
                  {t.description && (
                    <p className="mt-2 text-xs text-fg-muted">
                      {t.description}
                    </p>
                  )}
                </div>

                <div className="w-full shrink-0 sm:w-[280px]">
                  <ReviewForm taskId={t.id} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
