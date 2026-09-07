import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { chaseState } from "@/lib/chase";
import { pageInfo, parseListParams, type RawParams } from "@/lib/list-params";
import { fmtDate } from "@/lib/format";
import { PROPOSAL_TONE } from "@/lib/tone";
import { connectsStatus } from "@/server/connects-queries";
import {
  bdStats,
  chaseDueCount,
  countProposals,
  listProposals,
  pendingHandoffCount,
  PROPOSAL_SORT_KEYS,
} from "@/server/proposal-queries";
import {
  LOST_REASON_LABEL,
  PROPOSAL_VIEWS,
  STATUS_LABEL,
  VIEW_LABEL,
  type LostReason,
  type ProposalView,
} from "@/server/proposal-schemas";
import { PageHeader } from "@/components/app-shell";
import { Badge, MetricCard, MetricGrid } from "@/components/badges";
import { ProposalForm } from "@/components/proposal-form";
import {
  DataTable,
  EmptyCell,
  ListFilters,
  Pagination,
  Th,
} from "@/components/ui";

export const metadata = { title: "Sales" };

function parseView(raw: string | string[] | undefined): ProposalView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (PROPOSAL_VIEWS as readonly string[]).includes(v ?? "")
    ? (v as ProposalView)
    : // The chase is the default because it is the only view with a job in it.
      // Everything else is a record; this one is a queue.
      "chase";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "proposal.create")) notFound();

  const seesAll = can(role, "proposal.viewAll");
  const canConvert = can(role, "project.create");

  const params = await searchParams;
  const view = parseView(params.view);
  const list = parseListParams(params, {
    sortable: PROPOSAL_SORT_KEYS,
    // Oldest clock first in the queue; newest first everywhere else. A chase
    // list sorted by recency puts the least urgent row at the top.
    defaultSort: view === "chase" ? "cold" : "sent",
    defaultDesc: view !== "chase",
    pageSize: 25,
  });
  const opts = { view, list };

  const [stats, rows, total, dueNow, pendingHandoffs, connects] = await Promise.all([
    bdStats(actor.id, seesAll),
    listProposals(actor.id, seesAll, opts),
    countProposals(actor.id, seesAll, opts),
    chaseDueCount(actor.id),
    pendingHandoffCount(actor.id, seesAll),
    connectsStatus(),
  ]);

  const info = pageInfo(list, total);
  const now = new Date();
  const hrefFor = (v: ProposalView) =>
    v === "chase" ? "/sales" : `/sales?view=${v}`;

  return (
    <>
      <PageHeader
        eyebrow="PIPELINE"
        title="Sales"
        description={
          seesAll
            ? "Every rep's activity and outcomes on one row, so the two cannot be reported separately."
            : "What you have bid on, and what is waiting on a nudge."
        }
        primaryAction={
          <Link href="/sales?new=1" className="btn-primary btn-sm">
            + Log a proposal
          </Link>
        }
        tabs={[
          { href: "/sales", label: "Pipeline", active: true },
          { href: "/sales/connects", label: "Connects", active: false },
        ]}
        controls={
          <div className="flex w-full flex-col gap-3">
            {/* Chips, not a select: which view you are in has to be visible at
                a glance, because the default one hides most of the pipeline. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PROPOSAL_VIEWS.map((v) => (
                <Link
                  key={v}
                  href={hrefFor(v)}
                  aria-current={v === view ? "page" : undefined}
                  className={
                    v === view
                      ? "btn-dark btn-xs"
                      : "btn-secondary btn-xs"
                  }
                >
                  {VIEW_LABEL[v]}
                  {v === "chase" && dueNow > 0 ? ` (${dueNow})` : ""}
                </Link>
              ))}
            </div>
            <ListFilters
              action="/sales"
              params={params}
              placeholder="Job title, category or client"
              active={list}
              keepSort={false}
            >
              {/* Searching must not drop you out of the view you are in. */}
              <input type="hidden" name="view" value={view} />
              <div>
                <label className="label" htmlFor="filter-sort">
                  Sort by
                </label>
                <select
                  id="filter-sort"
                  name="sort"
                  defaultValue={list.desc ? `-${list.sort}` : (list.sort ?? "sent")}
                  className="field w-auto min-w-[150px]"
                >
                  <option value="cold">Coldest first</option>
                  <option value="-sent">Newest first</option>
                  <option value="sent">Oldest first</option>
                  <option value="-value">Largest first</option>
                  <option value="status">Stage</option>
                </select>
              </div>
            </ListFilters>
          </div>
        }
        summary={
          <MetricGrid>
            <MetricCard
              label="Sent this week"
              value={String(stats.sentWeek)}
              change={`${stats.sentToday} today`}
              note="Activity. On its own this number proves nothing."
            />
            <MetricCard
              label="Response rate"
              value={`${stats.responseRate.toFixed(0)}%`}
              changeTone={stats.responseRate >= 15 ? "positive" : "negative"}
              change={`${stats.responsesToday} today`}
              note="Replies, meetings and wins on proposals you sent."
            />
            {/* Displaces "meetings booked", which is readable off the table
                below. Whether the next bid can be placed at all is not. */}
            <MetricCard
              label="Connects"
              value={String(connects.balance)}
              changeTone={connects.level === 0 ? "positive" : "negative"}
              change={
                connects.runwayDays === null
                  ? `${stats.meetingsBooked} meetings`
                  : `~${connects.runwayDays}d left`
              }
              note={connects.reason}
            />
            <MetricCard
              label="Won this month"
              value={String(stats.wonMonth)}
              accent
              change={`$${stats.wonValueMonth.toLocaleString()}`}
              note={`${stats.winRate.toFixed(1)}% of proposals sent.`}
            />
          </MetricGrid>
        }
      />

      {params.new === "1" && (
        <div className="mb-4 max-w-[420px]">
          <ProposalForm />
        </div>
      )}

      {pendingHandoffs > 0 && (
        <div className="panel mb-4 flex items-center gap-3 px-4 py-3">
          <span className="h-[7px] w-[7px] rounded-full bg-ok" aria-hidden />
          <strong className="text-sm">{pendingHandoffs}</strong>
          <span className="text-xs text-fg-muted">
            {canConvert
              ? `won, waiting to become ${pendingHandoffs === 1 ? "a project" : "projects"}`
              : `of yours ${pendingHandoffs === 1 ? "is" : "are"} won and waiting on a handoff`}
          </span>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">{VIEW_LABEL[view].toUpperCase()}</p>
            <h3 className="m-0 text-lg tracking-[-.03em]">Proposals</h3>
          </div>
          {/* A default-filtered list reads as data loss unless it says so and
              offers the way out in the same breath. */}
          <span className="text-xs text-fg-muted">
            {info.total === 0
              ? "nothing here"
              : `showing ${info.from}–${info.to} of ${info.total}`}
            {view !== "all" && (
              <>
                {" · "}
                <Link href="/sales?view=all" className="font-bold text-brand hover:underline">
                  show all
                </Link>
              </>
            )}
          </span>
        </div>

        <DataTable minWidth={860}>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th numeric>Value</Th>
              <Th>Sent</Th>
              <Th>Cold for</Th>
              {seesAll && <Th>Owner</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyCell colSpan={seesAll ? 6 : 5}>
                {view === "chase"
                  ? "Nothing needs a chase. That is the queue empty, not broken."
                  : "No proposals match."}
              </EmptyCell>
            ) : (
              rows.map((r) => {
                const state = chaseState(
                  {
                    status: r.status,
                    sentAt: r.sentAt,
                    lastChasedAt: r.lastChasedAt,
                    chaseCount: r.chaseCount,
                  },
                  now,
                );
                return (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3">
                      <Link
                        href={`/sales/${r.id}`}
                        className="text-xs font-bold hover:underline"
                      >
                        {r.jobTitle}
                      </Link>
                      <p className="m-0 mt-1 text-2xs text-fg-muted">
                        {r.clientName ?? r.category ?? "Uncategorised"} · {r.source}
                        {r.lostReason
                          ? ` · ${LOST_REASON_LABEL[r.lostReason as LostReason]}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={PROPOSAL_TONE[r.status] ?? "neutral"}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="tabular px-5 py-3 text-right">
                      {r.wonValue
                        ? `$${Number(r.wonValue).toLocaleString()}`
                        : r.budgetAmount
                          ? `$${Number(r.budgetAmount).toLocaleString()}`
                          : "—"}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-xs text-fg-muted">
                      {fmtDate(r.sentAt)}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {state.dueAt === null && !state.exhausted ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        <span className={state.due || state.exhausted ? "text-warn" : "text-fg-muted"}>
                          {state.reason}
                        </span>
                      )}
                    </td>
                    {seesAll && (
                      <td className="px-5 py-3 text-xs text-fg-muted">{r.ownerName}</td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>

        {info.pages > 1 && (
          <Pagination info={info} pathname="/sales" params={params} unit="proposals" />
        )}
      </section>
    </>
  );
}
