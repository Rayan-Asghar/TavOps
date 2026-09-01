import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { unresolvedCount } from "@/server/notifications";
import {
  bdStats,
  listProposals,
  handoffOptions,
  pendingHandoffCount,
} from "@/server/proposal-queries";
import { STATUS_LABEL } from "@/server/proposal-schemas";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { Badge, MetricCard, MetricGrid } from "@/components/badges";
import { ProposalForm } from "@/components/proposal-form";
import { AdvanceStatus } from "@/components/proposal-actions";
import { HandoffForm } from "@/components/handoff-form";
import Link from "next/link";

import { fmtDate } from "@/lib/format";


import { PROPOSAL_TONE } from "@/lib/tone";
import { EmptyRow } from "@/components/ui";
export default async function SalesPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  const canCreate = can(role, "proposal.create");
  if (!canCreate) notFound();

  const seesAll = can(role, "proposal.viewAll");

  const canConvert = can(role, "project.create");

  const [stats, rows, count, options, pendingHandoffs] = await Promise.all([
    bdStats(actor.id, seesAll),
    listProposals(actor.id, seesAll),
    unresolvedCount(actor.id),
    canConvert ? handoffOptions() : Promise.resolve(null),
    canConvert ? pendingHandoffCount() : Promise.resolve(0),
  ]);

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={role}
      inboxCount={count}
      title="Sales"
    >
      <SectionIntro
        eyebrow="SALES → DELIVERY"
        title="Pipeline"
        description={
          seesAll
            ? "Every rep's activity and outcomes on one row, so the two cannot be reported separately."
            : "Your proposals, responses and follow-ups."
        }
      />

      <MetricGrid>
        <MetricCard
          label="Sent today"
          value={String(stats.sentToday)}
          change={`${stats.sentWeek} this week`}
          note="Activity. On its own this number proves nothing."
        />
        <MetricCard
          label="Responses today"
          value={String(stats.responsesToday)}
          change={`${stats.responseRate.toFixed(0)}% rate`}
          changeTone={stats.responseRate >= 15 ? "positive" : "negative"}
          note="Replies, meetings and wins on proposals you sent."
        />
        <MetricCard
          label="Meetings booked"
          value={String(stats.meetingsBooked)}
          note="Last 30 days."
        />
        <MetricCard
          label="Won this month"
          value={String(stats.wonMonth)}
          accent
          change={`$${stats.wonValueMonth.toLocaleString()}`}
          note={`${stats.winRate.toFixed(1)}% of proposals sent.`}
        />
      </MetricGrid>

      {pendingHandoffs > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="panel flex items-center gap-3 px-4 py-3">
            <span className="h-[7px] w-[7px] rounded-full bg-ok" aria-hidden />
            <strong className="text-sm">{pendingHandoffs}</strong>
            <span className="text-xs text-fg-muted">
              won, waiting to become projects
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">PIPELINE</p>
                <h3 className="m-0 text-xl tracking-[-.035em]">Proposals</h3>
              </div>
              <span className="text-xs text-fg-muted">{rows.length} shown</span>
            </div>

            {rows.length === 0 ? (
              <EmptyRow>No proposals logged yet.</EmptyRow>
            ) : (
              <ul>
                {rows.map((r) => {
                  return (
                    <li
                      key={r.id}
                      className="border-b border-border p-4 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-xs">{r.jobTitle}</strong>
                            <Badge tone={PROPOSAL_TONE[r.status] ?? "neutral"}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-fg-muted">
                            {r.category ?? "Uncategorised"} · {r.source} ·{" "}
                            {r.budgetAmount ? `$${r.budgetAmount}` : "no budget"} ·
                            sent {fmtDate(r.sentAt)}
                            {seesAll && r.ownerName && ` · ${r.ownerName}`}
                            {r.status === "won" && r.wonValue && ` · won $${r.wonValue}`}
                          </p>
                          {r.jobUrl && (
                            <a
                              href={r.jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block text-xs font-bold text-brand hover:underline"
                            >
                              Open job ↗
                            </a>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {(r.ownerId === actor.id || seesAll) && (
                            <AdvanceStatus proposalId={r.id} status={r.status} />
                          )}
                          {r.status === "won" && r.wonProjectId && (
                            <Link
                              href={`/projects/${r.wonProjectId}`}
                              className="text-xs font-bold text-brand hover:underline"
                            >
                              Delivered as a project →
                            </Link>
                          )}
                          {r.status === "won" && !r.wonProjectId && (
                            canConvert && options ? (
                              <HandoffForm
                                proposalId={r.id}
                                suggestedName={r.jobTitle}
                                suggestedType={r.category}
                                suggestedValue={r.wonValue ?? r.budgetAmount}
                                clients={options.clients}
                                leads={options.leads}
                                pms={options.pms}
                              />
                            ) : (
                              <Badge tone="amber">Awaiting handoff</Badge>
                            )
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside>{canCreate && <ProposalForm />}</aside>
      </div>
    </AppShell>
  );
}
