import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, tasks, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { inboxFor, snoozedFor, unresolvedCount } from "@/server/notifications";
import { recentProjectsFor } from "@/server/recent";
import { DismissButton } from "@/components/dismiss-button";
import { SnoozeButton } from "@/components/snooze-button";
import { UnsnoozeButton } from "@/components/unsnooze-button";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { Badge, HealthBadge, MetricCard, MetricGrid, type Tone } from "@/components/badges";
import { ArrowRightIcon } from "@/components/icons";

import { timeAgo } from "@/lib/format";


import { KIND_META, SIGNAL_COLOR, type Signal } from "@/lib/tone";
import { EmptyState } from "@/components/ui";

// title.template applies to child segments only, and the root page shares a
// segment with the root layout — so this one carries the suffix itself.
export const metadata = { title: { absolute: "Needs attention · TavrenOPS" } };
export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [items, count, scope, recents, snoozed] = await Promise.all([
    inboxFor(actor.id),
    unresolvedCount(actor.id),
    accessibleProjectIds(actor),
    recentProjectsFor(actor, 4),
    snoozedFor(actor.id),
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
        {/* The accent marks the page's headline metric, as it does on
            /reports, /review and /sales. Here that is what is waiting on you —
            not the project count, which is scope rather than a number anyone
            acts on, and which was previously the loudest thing on a page whose
            whole premise is that only exceptions are worth looking at. The
            accent is dropped entirely when the queue is empty: an inbox with
            nothing in it should read as finished, not shout a zero. */}
        <MetricCard
          label="Waiting on you"
          value={String(actionable.length)}
          change={urgent > 0 ? `${urgent} urgent` : undefined}
          changeTone="negative"
          accent={actionable.length > 0}
          quiet={actionable.length === 0}
          note="Blockers, reviews and reporting gaps assigned to you."
        />
        <MetricCard
          label="Blockers to clear"
          value={String(myBlockers?.n ?? 0)}
          quiet={(myBlockers?.n ?? 0) === 0}
          note="Routed to you because you can unblock them."
        />
        <MetricCard
          label="Your open tasks"
          value={String(myTasks?.n ?? 0)}
          quiet={(myTasks?.n ?? 0) === 0}
          note="Assigned work that is not yet done."
        />
        <MetricCard
          label="Your projects"
          value={scope === null ? "All" : String(scope.length)}
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
              <h3 className="m-0 text-xl tracking-[-.035em]">
                Requires action
              </h3>
            </div>
            <span className="text-xs text-fg-muted">
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
                    <strong className="block text-xs">{n.title}</strong>
                    {n.body && (
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-2xs text-fg-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:shrink-0 sm:justify-end">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {/* Review items open the queue rather than the project:
                        the queue is where the approve / send-back decision is
                        actually made, and it carries the revision round. */}
                    {n.kind === "task_needs_review" ? (
                      <Link
                        href="/review"
                        className="btn-text"
                        aria-label={`Open review queue for: ${n.title}`}
                      >
                        Review <ArrowRightIcon />
                      </Link>
                    ) : (
                      n.projectId && (
                        <Link
                          href={`/projects/${n.projectId}`}
                          className="btn-text"
                          aria-label={`Open project for: ${n.title}`}
                        >
                          Open <ArrowRightIcon />
                        </Link>
                      )
                    )}
                    <SnoozeButton id={n.id} title={n.title} />
                    <DismissButton id={n.id} title={n.title} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <EmptyState
          variant="cleared"
          title="You're All Clear"
          className="mb-4"
        >
          Nothing needs a decision from you right now. Blockers, reviews and
          reporting gaps land here the moment they are routed to you.
        </EmptyState>
      )}

      {/* 2.6: a queue you cannot look behind is one nobody trusts enough to
          empty, so what is deferred stays visible and reversible in one click.
          Collapsed by default -- it is not work for today. */}
      {snoozed.length > 0 && (
        <details className="panel group mb-4">
          <summary
            className="flex min-h-[52px] cursor-pointer list-none items-center gap-2.5 px-4
                       text-xs font-bold text-fg-muted
                       transition-[color,background-color] duration-150 ease-out-quad
                       hover:bg-surface-hover hover:text-fg"
          >
            <span
              aria-hidden
              className="inline-block transition-transform duration-150 ease-out-quad group-open:rotate-90"
            >
              &rsaquo;
            </span>
            {snoozed.length} snoozed
            <span className="font-medium text-fg-subtle">
              &mdash; back on its own, or sooner if it happens again
            </span>
          </summary>
          <ul className="border-t border-border">
            {snoozed.map((n) => (
              <li
                key={n.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                <span className="tabular shrink-0 text-2xs text-fg-subtle">
                  {n.snoozedUntil ? `back ${timeAgo(n.snoozedUntil)}` : ""}
                </span>
                <UnsnoozeButton id={n.id} title={n.title} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* r12 makes recent work required on the dashboard, not optional, and NN/g
          recommends a "continue where you left off" surface for interrupted work
          -- which is most work on a two-person team. It sits BELOW the queue on
          purpose: this page's premise is that only exceptions deserve attention,
          so picking up yesterday's thread must not outrank something waiting on a
          decision. Quiet row, no metric, no accent. */}
      {recents.length > 0 && (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p>
              <h3 className="m-0 text-xl tracking-[-.035em]">Recent projects</h3>
            </div>
            <span className="text-xs text-fg-muted">Last touched by you</span>
          </div>
          <ul>
            {recents.map((p) => (
              <li key={p.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/projects/${p.id}`}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-2.5
                             transition-[color,background-color] duration-150 ease-out-quad
                             hover:bg-surface-hover"
                >
                  <span className="shrink-0 font-mono text-2xs text-fg-muted">
                    {p.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold">
                    {p.name}
                  </span>
                  <HealthBadge health={p.health} />
                  <span className="tabular shrink-0 text-2xs text-fg-subtle">
                    {timeAgo(p.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {informational.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">FOR INFORMATION</p>
              <h3 className="m-0 text-xl tracking-[-.035em]">Recent</h3>
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
                  className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0"
                >
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="shrink-0 text-2xs text-fg-subtle">
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
