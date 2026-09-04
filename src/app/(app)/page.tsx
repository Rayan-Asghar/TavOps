import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, tasks } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { inboxFor, snoozedFor } from "@/server/notifications";
import { recentProjectsFor } from "@/server/recent";
import { hoursByDay } from "@/server/reports";
import { MiniBars } from "@/components/charts";
import { AttentionQueue } from "@/components/attention-queue";
import { UnsnoozeButton } from "@/components/unsnooze-button";
import { SectionIntro } from "@/components/app-shell";
import { Badge, HealthBadge, type Tone } from "@/components/badges";

import { timeAgo } from "@/lib/format";


import { KIND_META, type Signal } from "@/lib/tone";
import { EmptyState } from "@/components/ui";

// title.template applies to child segments only, and the root page shares a
// segment with the root layout — so this one carries the suffix itself.
export const metadata = { title: { absolute: "Needs attention · TavrenOPS" } };
export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");


  /* The last fortnight, so the bars have enough shape to read as a rhythm
     rather than a handful of sticks. */
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);

  // The day series is scoped to what this person may see, so it has to wait for
  // the scope rather than race it.
  const scope = await accessibleProjectIds(actor);

  const [items, recents, snoozed, days] = await Promise.all([
    inboxFor(actor.id),
    recentProjectsFor(actor, 4),
    snoozedFor(actor.id),
    hoursByDay({ from, to }, scope),
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
  const fortnightTotal = days.reduce((sum, d) => sum + d.hours, 0);
  const urgent = actionable.filter(
    (i) => KIND_META[i.kind]?.signal === "critical",
  ).length;

  return (
    <>
      <SectionIntro
        eyebrow="EXCEPTION-DRIVEN OPERATIONS"
        title="Needs attention"
        description="Only work that requires a decision, response, review or escalation lands here. Everything else stays out of your way."
      />

      {/* This page used to open with four counters that, on a good day, all
          read 0 — an exception-driven dashboard whose first impression was four
          grey zeros. The count that matters keeps its size; the other three
          become one line under it, because "nothing is blocked" deserves a
          clause, not a tile. Beside them is the fortnight's rhythm, which is the
          question people actually open this page with when the queue is empty:
          is work still going in? */}
      <section className="panel mb-4 overflow-hidden">
        <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <span className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
              Waiting on you
            </span>
            <strong
              className={`tabular mt-2 block text-5xl leading-none tracking-[-.045em] ${
                actionable.length === 0 ? "text-fg-subtle" : ""
              }`}
            >
              {actionable.length}
            </strong>
            {urgent > 0 && (
              <span className="mt-2 inline-block text-2xs font-bold text-danger">
                {urgent} urgent
              </span>
            )}
            <p className="m-0 mt-3 text-xs text-fg-muted">
              <span className="tabular font-bold text-fg">
                {myBlockers?.n ?? 0}
              </span>{" "}
              blocker{(myBlockers?.n ?? 0) === 1 ? "" : "s"} to clear
              <br />
              <span className="tabular font-bold text-fg">{myTasks?.n ?? 0}</span>{" "}
              open task{(myTasks?.n ?? 0) === 1 ? "" : "s"} across{" "}
              <span className="tabular font-bold text-fg">
                {scope === null ? "all" : scope.length}
              </span>{" "}
              project{scope !== null && scope.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="p-5">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <span className="text-2xs font-bold uppercase tracking-[.1em] text-fg-muted">
                Last 14 days
              </span>
              <span className="tabular text-2xs text-fg-muted">
                {fortnightTotal.toFixed(1)}h logged
              </span>
            </div>
            <MiniBars
              values={days.map((d) => d.hours)}
              labels={days.map((d) =>
                new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                }),
              )}
              height={64}
              /* No accent on "today": the point here is the fortnight's rhythm,
                 and a part-finished day is not a highlight. */
              highlightLast={false}
              emptyLabel="Nothing logged in the last fortnight."
            />
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-2xs text-fg-muted">
              <span>two weeks ago</span>
              <span>today</span>
            </div>
          </div>
        </div>
      </section>

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

          <AttentionQueue
            items={actionable.map((n) => ({
              id: n.id,
              kind: n.kind,
              title: n.title,
              body: n.body,
              projectId: n.projectId,
              createdAt: n.createdAt,
            }))}
          />
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
    </>
  );
}
