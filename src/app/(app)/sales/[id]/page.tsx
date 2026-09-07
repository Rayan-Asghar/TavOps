import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, workLogs } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { canAccessProject } from "@/lib/access";
import { chaseState } from "@/lib/chase";
import { businessHoursBetween, HOURS_PER_DAY } from "@/lib/business-time";
import { fmtDate, hrs } from "@/lib/format";
import { PROPOSAL_TONE } from "@/lib/tone";
import {
  clientOptions,
  handoffOptions,
  proposalDetail,
} from "@/server/proposal-queries";
import { connectsForProposal } from "@/server/connects-queries";
import { KIND_LABEL, type LedgerKind } from "@/server/connects-schemas";
import { LOST_REASON_LABEL, STATUS_LABEL, type LostReason } from "@/server/proposal-schemas";
import { PageHeader } from "@/components/app-shell";
import { Badge, HealthBadge } from "@/components/badges";
import { AdvanceStatus, MarkChased } from "@/components/proposal-actions";
import { ProposalClientLink } from "@/components/proposal-client-link";
import { HandoffForm } from "@/components/handoff-form";

export const metadata = { title: "Proposal" };

/** The funnel, rebuilt from the four timestamps that were always being kept. */
function timeline(p: {
  sentAt: Date;
  respondedAt: Date | null;
  meetingAt: Date | null;
  decidedAt: Date | null;
}) {
  const steps: { label: string; at: Date | null }[] = [
    { label: "Sent", at: p.sentAt },
    { label: "Replied", at: p.respondedAt },
    { label: "Meeting", at: p.meetingAt },
    { label: "Decided", at: p.decidedAt },
  ];
  const reached = steps.filter((s) => s.at !== null) as { label: string; at: Date }[];
  return reached.map((s, i) => ({
    label: s.label,
    at: s.at,
    // The gap is the interesting part: it is how long they left us waiting.
    gapDays:
      i === 0
        ? null
        : Math.round(businessHoursBetween(reached[i - 1].at, s.at) / HOURS_PER_DAY),
  }));
}

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "proposal.create")) notFound();

  const { id } = await params;
  const p = await proposalDetail(id);
  if (!p) notFound();

  const seesAll = can(role, "proposal.viewAll");
  // 404 rather than 403: a rep should not learn that somebody else's deal
  // exists by being told they may not see it.
  if (p.ownerId !== actor.id && !seesAll) notFound();

  const canConvert = can(role, "project.create");
  const [clients, handoff, spend] = await Promise.all([
    clientOptions(),
    canConvert && p.status === "won" && !p.wonProjectId
      ? handoffOptions()
      : Promise.resolve(null),
    connectsForProposal(id),
  ]);
  const connectsSpent = spend.reduce((n, e) => n + Math.abs(e.delta), 0);

  /* What became of it. Hours only, never money: a rep has no finance.view, and
     the project's own money tab already refuses without both the capability and
     the RLS opt-in. This asks for neither, so there is nothing to suppress. */
  let delivered: { hours: number; visible: boolean } | null = null;
  if (p.wonProjectId) {
    const visible = await canAccessProject(actor, p.wonProjectId);
    if (visible) {
      const [row] = await db
        .select({ h: sql<string>`coalesce(sum(${workLogs.hours}), 0)::text` })
        .from(workLogs)
        .where(and(eq(workLogs.projectId, p.wonProjectId), isNull(workLogs.deletedAt)));
      delivered = { hours: Number(row?.h ?? 0), visible: true };
    } else {
      delivered = { hours: 0, visible: false };
    }
  }

  const state = chaseState(
    {
      status: p.status,
      sentAt: p.sentAt,
      lastChasedAt: p.lastChasedAt,
      chaseCount: p.chaseCount,
    },
    new Date(),
  );
  const steps = timeline(p);

  return (
    <>
      <PageHeader
        eyebrow="PROPOSAL"
        title={p.jobTitle}
        description={[
          p.clientName,
          p.category,
          p.source,
          seesAll && p.ownerName ? `owned by ${p.ownerName}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          p.jobUrl ? (
            <a
              href={p.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm"
            >
              Open job ↗
            </a>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">WHERE IT GOT TO</p>
                <h3 className="m-0 text-lg tracking-[-.03em]">Timeline</h3>
              </div>
              <Badge tone={PROPOSAL_TONE[p.status] ?? "neutral"}>
                {STATUS_LABEL[p.status] ?? p.status}
              </Badge>
            </div>
            <ol className="m-0 list-none p-0">
              {steps.map((s) => (
                <li
                  key={s.label}
                  className="flex items-baseline justify-between border-b border-border px-5 py-3 last:border-b-0"
                >
                  <span className="text-xs font-bold">{s.label}</span>
                  <span className="text-xs text-fg-muted">
                    {fmtDate(s.at)}
                    {/* A zero gap is noise, and it is usually a weekend
                        rather than a same-day reply. */}
                    {s.gapDays !== null && s.gapDays > 0 && (
                      <span className="ml-2 text-fg-subtle">
                        +{s.gapDays} working {s.gapDays === 1 ? "day" : "days"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {p.lostReason && (
              <p className="m-0 border-t border-border px-5 py-3 text-xs">
                <strong>Lost:</strong> {LOST_REASON_LABEL[p.lostReason as LostReason]}
                {p.lostNote ? ` — ${p.lostNote}` : ""}
              </p>
            )}
            {p.notes && (
              <p className="m-0 border-t border-border px-5 py-3 text-xs text-fg-muted">
                {p.notes}
              </p>
            )}
          </section>

          {p.wonProjectId && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">AFTER THE WIN</p>
                  <h3 className="m-0 text-lg tracking-[-.03em]">What became of it</h3>
                </div>
                {p.projectHealth && <HealthBadge health={p.projectHealth} />}
              </div>
              {delivered?.visible ? (
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-5 py-4">
                  <Link
                    href={`/projects/${p.wonProjectId}`}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    {p.projectCode} {p.projectName} →
                  </Link>
                  <span className="text-xs text-fg-muted">{p.projectLifecycle}</span>
                  <span className="tabular text-xs">
                    <strong>{hrs(delivered.hours)}h</strong>{" "}
                    <span className="text-fg-muted">delivered so far</span>
                  </span>
                </div>
              ) : (
                <p className="m-0 px-5 py-4 text-xs text-fg-muted">
                  It became a project you are not on, so there is nothing to show here.
                </p>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {connectsSpent > 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">WHAT IT COST TO PLACE</p>
                  <h3 className="m-0 text-lg tracking-[-.03em]">Connects</h3>
                </div>
                <strong className="tabular text-lg">{connectsSpent}</strong>
              </div>
              <ul className="m-0 list-none p-0">
                {spend.map((e) => (
                  <li
                    key={`${e.kind}-${e.occurredAt.toISOString()}`}
                    className="flex items-baseline justify-between border-b border-border px-5 py-2.5 last:border-b-0 text-xs"
                  >
                    <span>{KIND_LABEL[e.kind as LedgerKind] ?? e.kind}</span>
                    <span className="tabular text-fg-muted">{Math.abs(e.delta)}</span>
                  </li>
                ))}
              </ul>
              {/* Connects, never dollars. Pricing a spend needs a costing
                  basis, and a basis chosen for a report is a number somebody
                  will price a decision off — see 0023. */}
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">THE CHASE</p>
                <h3 className="m-0 text-lg tracking-[-.03em]">Follow-up</h3>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p
                className={`m-0 text-xs ${
                  state.due || state.exhausted ? "text-warn" : "text-fg-muted"
                }`}
              >
                {state.reason}
              </p>
              {p.lastChasedAt && (
                <p className="m-0 text-2xs text-fg-muted">
                  Last chased {fmtDate(p.lastChasedAt)}.
                </p>
              )}
              {p.status !== "won" && p.status !== "lost" && (
                <MarkChased proposalId={p.id} chaseCount={p.chaseCount} />
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">MOVE IT</p>
                <h3 className="m-0 text-lg tracking-[-.03em]">Stage</h3>
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <AdvanceStatus proposalId={p.id} status={p.status} />
              <ProposalClientLink
                proposalId={p.id}
                clientId={p.clientId}
                clients={clients}
              />
            </div>
          </section>

          {p.status === "won" && !p.wonProjectId && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">SALES → DELIVERY</p>
                  <h3 className="m-0 text-lg tracking-[-.03em]">Handoff</h3>
                </div>
              </div>
              <div className="px-5 py-4">
                {handoff ? (
                  <HandoffForm
                    proposalId={p.id}
                    suggestedName={p.jobTitle}
                    suggestedType={p.category}
                    suggestedValue={p.wonValue ?? p.budgetAmount}
                    clients={handoff.clients}
                    leads={handoff.leads}
                    pms={handoff.pms}
                  />
                ) : (
                  <p className="m-0 text-xs text-fg-muted">
                    Won, and waiting on somebody who can create the project.
                  </p>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
