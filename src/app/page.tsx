import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, tasks, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { inboxFor, unresolvedCount } from "@/server/notifications";
import { dismissNotification } from "@/server/inbox-actions";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { Badge, MetricCard, MetricGrid, type Tone } from "@/components/badges";
import { ArrowRightIcon } from "@/components/icons";

type Signal = "critical" | "review" | "warning" | "waiting";

const KIND_META: Record<
  string,
  { label: string; tone: Tone; signal: Signal }
> = {
  blocker_opened: { label: "Blocker", tone: "red", signal: "critical" },
  blocker_escalated: { label: "Escalated", tone: "red", signal: "critical" },
  blocker_resolved: { label: "Resolved", tone: "green", signal: "review" },
  task_assigned: { label: "Assigned", tone: "blue", signal: "review" },
  task_needs_review: { label: "Review", tone: "violet", signal: "review" },
  task_stalled: { label: "Stalled", tone: "amber", signal: "warning" },
  update_missing: { label: "Reporting", tone: "amber", signal: "warning" },
  sync_failed: { label: "Sync failed", tone: "red", signal: "critical" },
  project_at_risk: { label: "At risk", tone: "amber", signal: "warning" },
};

const SIGNAL_COLOR: Record<Signal, string> = {
  critical: "bg-brand",
  review: "bg-info",
  warning: "bg-[#df9c00]",
  waiting: "bg-[#777]",
};

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [items, count, scope] = await Promise.all([
    inboxFor(actor.id),
    unresolvedCount(actor.id),
    accessibleProjectIds(actor),
  ]);

  const [myBlockers] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blockers)
    .where(
      and(eq(blockers.assignedToId, actor.id), ne(blockers.status, "resolved")),
    );

  const [myTasks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, actor.id), ne(tasks.status, "done")));

  const actionable = items.filter((i) => i.isActionable);
  const informational = items.filter((i) => !i.isActionable);
  const urgent = actionable.filter(
    (i) => KIND_META[i.kind]?.signal === "critical",
  ).length;

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={me?.globalRole ?? "developer"}
      inboxCount={count}
      title="Needs attention"
    >
      <SectionIntro
        eyebrow="EXCEPTION-DRIVEN OPERATIONS"
        title="Needs attention"
        description="Only work that requires a decision, response, review or escalation lands here. Everything else stays out of your way."
      />

      <MetricGrid>
        <MetricCard
          label="Waiting on you"
          value={String(actionable.length)}
          change={urgent > 0 ? `${urgent} urgent` : undefined}
          changeTone="negative"
          note="Blockers, reviews and reporting gaps assigned to you."
        />
        <MetricCard
          label="Blockers to clear"
          value={String(myBlockers?.n ?? 0)}
          note="Routed to you because you can unblock them."
        />
        <MetricCard
          label="Your open tasks"
          value={String(myTasks?.n ?? 0)}
          note="Assigned work that is not yet done."
        />
        <MetricCard
          label="Your projects"
          value={scope === null ? "All" : String(scope.length)}
          accent
          note={
            scope === null
              ? "Your role sees every project."
              : "Projects you are assigned to or own."
          }
        />
      </MetricGrid>

      {actionable.length > 0 ? (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <p className="eyebrow">PRIORITY QUEUE</p>
              <h3 className="m-0 text-[18px] tracking-[-.035em]">
                Requires action
              </h3>
            </div>
            <span className="text-[11px] text-fg-muted">
              {actionable.length} item{actionable.length === 1 ? "" : "s"}
            </span>
          </div>

          <ul>
            {actionable.map((n) => {
              const meta = KIND_META[n.kind] ?? {
                label: n.kind,
                tone: "neutral" as Tone,
                signal: "waiting" as Signal,
              };
              return (
                <li key={n.id} className="attention-row">
                  <span
                    className={`mt-1.5 signal ${SIGNAL_COLOR[meta.signal]}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <strong className="block text-[12px]">{n.title}</strong>
                    {n.body && (
                      <span className="mt-0.5 block text-[10px] text-fg-muted">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[9px] text-fg-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:shrink-0 sm:justify-end">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {n.projectId && (
                      <Link
                        href={`/projects/${n.projectId}`}
                        className="btn-text"
                        aria-label={`Open project for: ${n.title}`}
                      >
                        Open <ArrowRightIcon />
                      </Link>
                    )}
                    <form action={dismissNotification}>
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        type="submit"
                        className="text-[11px] font-bold text-fg-muted hover:text-danger"
                      >
                        Dismiss
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="panel mb-4 p-12 text-center">
          <p className="m-0 text-[13px] text-fg-muted">
            Nothing is waiting on you. Anything that needs a decision will
            appear here.
          </p>
        </section>
      )}

      {informational.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">FOR INFORMATION</p>
              <h3 className="m-0 text-[18px] tracking-[-.035em]">Recent</h3>
            </div>
          </div>
          <ul>
            {informational.map((n) => {
              const meta = KIND_META[n.kind] ?? {
                label: n.kind,
                tone: "neutral" as Tone,
                signal: "waiting" as Signal,
              };
              return (
                <li
                  key={n.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 text-[11px] last:border-b-0"
                >
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="shrink-0 text-[9px] text-fg-subtle">
                    {timeAgo(n.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
