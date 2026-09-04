import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { PageHeader, SummaryStrip } from "@/components/app-shell";
import { DataTable, Td, Th, TRow } from "@/components/ui";
import { HealthBadge } from "@/components/badges";
import { clientDetail } from "@/server/client-queries";
import { clientMoneyRows } from "@/server/margin-queries";
import { fmtDate, hrs, money as fmtMoney } from "@/lib/format";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { id } = await params;

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  const role = me?.globalRole ?? "developer";

  const scope = await accessibleProjectIds(actor);
  const detail = await clientDetail(id, scope);
  // 404 rather than an empty page: a client reachable only through projects you
  // cannot see should not confirm that the client exists.
  if (!detail) notFound();

  const seesMoney = can(role, "finance.view");
  const money = seesMoney
    ? (await clientMoneyRows([id], scope, role)).get(id)
    : undefined;

  const totalHours = detail.projects.reduce(
    (s, p) => s + Number(p.loggedHours),
    0,
  );

  const figures = [
    { label: "Projects", value: String(detail.projects.length) },
    { label: "Hours logged", value: `${hrs(totalHours)}h` },
  ];
  if (money) {
    figures.push(
      {
        label: "Revenue",
        value: money.revenueAmount
          ? fmtMoney(Number(money.revenueAmount), money.currency)
          : "—",
      },
      {
        label: "Cost",
        value: money.costAmount
          ? fmtMoney(Number(money.costAmount), money.currency)
          : "—",
      },
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={detail.client.industry ?? "Client"}
        title={detail.client.name}
        description={
          detail.client.primaryContactName
            ? `Primary contact: ${detail.client.primaryContactName}${
                detail.client.primaryContactEmail
                  ? ` · ${detail.client.primaryContactEmail}`
                  : ""
              }`
            : undefined
        }
        actions={
          <Link href="/clients" className="btn-secondary btn-sm">
            All clients
          </Link>
        }
        summary={<SummaryStrip figures={figures} />}
      />

      <DataTable>
        <thead>
          <tr>
            <Th>Project</Th>
            <Th>Health</Th>
            <Th numeric>Hours</Th>
            <Th numeric>Internal due</Th>
          </tr>
        </thead>
        <tbody>
          {detail.projects.map((p) => (
            <TRow key={p.id}>
              <Td>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-baseline gap-2 font-bold hover:text-brand"
                >
                  <span className="font-mono text-2xs text-fg-muted">
                    {p.code}
                  </span>
                  <span>{p.name}</span>
                </Link>
              </Td>
              <Td>
                <HealthBadge health={p.health as never} />
              </Td>
              <Td numeric>{hrs(Number(p.loggedHours))}h</Td>
              <Td numeric>{fmtDate(p.internalDueDate)}</Td>
            </TRow>
          ))}
        </tbody>
      </DataTable>

      {detail.client.notes && (
        <section className="panel mt-4 p-5">
          <p className="eyebrow">Notes</p>
          <p className="m-0 whitespace-pre-wrap text-xs text-fg-muted">
            {detail.client.notes}
          </p>
        </section>
      )}
    </>
  );
}
