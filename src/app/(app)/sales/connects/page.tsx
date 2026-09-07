import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { connectsSpend } from "@/lib/connects";
import { pageInfo, parseListParams, type RawParams } from "@/lib/list-params";
import { fmtDate } from "@/lib/format";
import {
  connectsSpendCents,
  connectsStatus,
  countLedger,
  lastReconcile,
  listLedger,
} from "@/server/connects-queries";
import { KIND_LABEL, type LedgerKind } from "@/server/connects-schemas";
import { PageHeader } from "@/components/app-shell";
import { Badge, MetricCard, MetricGrid } from "@/components/badges";
import { RecordConnectsForm, ReconcileForm } from "@/components/connects-form";
import { DataTable, EmptyCell, Pagination, Th } from "@/components/ui";

export const metadata = { title: "Connects" };

const TONE: Record<LedgerKind, "green" | "red" | "amber" | "neutral"> = {
  purchase: "green",
  grant: "green",
  refund: "green",
  bid: "neutral",
  boost: "amber",
  expiry: "red",
  reconcile: "amber",
};

/** Working days since a date, roughly — enough for "12 days ago". */
function daysAgo(d: Date) {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export default async function ConnectsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
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
  const canManage = can(role, "connects.manage");

  const params = await searchParams;
  const list = parseListParams(params, { pageSize: 25 });

  const [status, rows, total, reconciled, spendCents] = await Promise.all([
    connectsStatus(),
    listLedger(list),
    countLedger(),
    lastReconcile(),
    connectsSpendCents(30),
  ]);

  const info = pageInfo(list, total);
  const staleReconcile = reconciled === null || daysAgo(reconciled.at) > 30;

  return (
    <>
      <PageHeader
        eyebrow="PIPELINE"
        title="Connects"
        description="What it costs to bid, and whether there are enough left to bid again."
        tabs={[
          { href: "/sales", label: "Pipeline", active: false },
          { href: "/sales/connects", label: "Connects", active: true },
        ]}
        summary={
          <MetricGrid>
            <MetricCard
              label="Balance"
              value={String(status.balance)}
              accent={status.level === 0}
              changeTone={status.level === 0 ? "positive" : "negative"}
              change={status.level > 0 ? "low" : undefined}
              note={status.reason}
            />
            <MetricCard
              label="Runway"
              value={status.runwayDays === null ? "—" : `${status.runwayDays}d`}
              note={
                status.runwayDays === null
                  ? "No recent bids to judge a burn rate from."
                  : "Working days at the recent rate."
              }
            />
            <MetricCard
              label="Spent on connects"
              value={connectsSpend(spendCents)}
              note="Last 30 days. Purchases only."
            />
            <MetricCard
              label="Last reconciled"
              value={reconciled === null ? "Never" : `${daysAgo(reconciled.at)}d ago`}
              changeTone={staleReconcile ? "negative" : "positive"}
              change={
                reconciled === null
                  ? undefined
                  : `was ${Math.abs(reconciled.drift)} ${reconciled.drift > 0 ? "short" : "over"}`
              }
              /* Not decoration. This ledger drifts from Upwork by design --
                 free monthly connects nobody records, Upwork's own refunds,
                 silent expiry -- and a balance whose drift is invisible decays
                 into fiction, at which point the alert gets muted. */
              note={
                staleReconcile
                  ? "Check it against Upwork; the longer it runs, the less this balance means."
                  : "The difference is recorded as its own entry."
              }
            />
          </MetricGrid>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel min-w-0">
          <div className="panel-head">
            <div>
              <p className="eyebrow">EVERY MOVEMENT</p>
              <h3 className="m-0 text-lg tracking-[-.03em]">Ledger</h3>
            </div>
            <span className="text-xs text-fg-muted">
              {info.total === 0
                ? "nothing recorded yet"
                : `showing ${info.from}–${info.to} of ${info.total}`}
            </span>
          </div>

          <DataTable minWidth={720}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th numeric>Connects</Th>
                <Th numeric>Cost</Th>
                <Th>Against</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyCell colSpan={5}>
                  Nothing recorded yet. Log a purchase to start the balance.
                </EmptyCell>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 whitespace-nowrap text-xs text-fg-muted">
                      {fmtDate(r.occurredAt)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE[r.kind as LedgerKind] ?? "neutral"}>
                        {KIND_LABEL[r.kind as LedgerKind] ?? r.kind}
                      </Badge>
                    </td>
                    <td
                      className={`tabular px-5 py-3 text-right text-xs font-bold ${
                        r.delta > 0 ? "text-ok" : ""
                      }`}
                    >
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-xs text-fg-muted">
                      {r.amountCents === null
                        ? "—"
                        : connectsSpend(r.amountCents, r.currency)}
                    </td>
                    <td className="px-5 py-3 text-xs text-fg-muted">
                      {r.proposalId ? (
                        <Link
                          href={`/sales/${r.proposalId}`}
                          className="font-bold text-brand hover:underline"
                        >
                          {r.jobTitle}
                        </Link>
                      ) : (
                        (r.note ?? "—")
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          {info.pages > 1 && (
            <Pagination
              info={info}
              pathname="/sales/connects"
              params={params}
              unit="entries"
            />
          )}
        </section>

        <aside className="space-y-4">
          {canManage ? (
            <>
              <section className="panel p-5">
                <h3 className="m-0 mb-3 text-lg tracking-[-.03em]">Record</h3>
                <RecordConnectsForm />
              </section>
              <section className="panel p-5">
                <h3 className="m-0 mb-1 text-lg tracking-[-.03em]">
                  Square it with Upwork
                </h3>
                <p className="mb-3 text-xs text-fg-muted">
                  This ledger drifts. Recording the difference is what keeps the
                  balance meaningful.
                </p>
                <ReconcileForm balance={status.balance} />
              </section>
            </>
          ) : (
            <section className="panel p-5">
              <p className="m-0 text-xs text-fg-muted">
                You can see the balance but not change it.
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
