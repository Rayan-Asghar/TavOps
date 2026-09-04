import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { PageHeader, SummaryStrip } from "@/components/app-shell";
import { DataTable, EmptyState, Td, Th, TRow } from "@/components/ui";
import { clientDirectory } from "@/server/client-queries";
import { clientMoneyRows } from "@/server/margin-queries";
import { fmtDate, hrs, money as fmtMoney } from "@/lib/format";

export const metadata = { title: "Clients" };

/**
 * Who the agency works for.
 *
 * The `clients` table has existed since the first migration and had no screen,
 * so a client was only ever a name in a project's subtitle — you could not ask
 * "how much have we done for them" without reading every project.
 */
export default async function ClientsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  const role = me?.globalRole ?? "developer";

  const scope = await accessibleProjectIds(actor);
  const rows = await clientDirectory(scope);
  const seesMoney = can(role, "finance.view");
  const moneyByClient = await clientMoneyRows(
    rows.map((r) => r.id),
    scope,
    role,
  );

  const totalHours = rows.reduce((s, r) => s + Number(r.loggedHours), 0);
  const active = rows.filter((r) => r.activeProjects > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Clients"
        description={
          scope === null
            ? "Everyone the agency works for, and what has gone into each."
            : "The clients whose projects you work on."
        }
        summary={
          rows.length > 0 ? (
            <SummaryStrip
              figures={[
                { label: "Clients", value: String(rows.length) },
                { label: "With live work", value: String(active) },
                { label: "Hours logged", value: `${hrs(totalHours)}h` },
              ]}
            />
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState variant="blank-slate" title="No Clients Yet">
          Clients appear here once a project is attached to one. Create a
          project and give it a client to start.
        </EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Projects</Th>
              <Th numeric>Hours</Th>
              {seesMoney && <Th numeric>Revenue</Th>}
              {seesMoney && <Th numeric>Cost</Th>}
              <Th numeric>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const m = moneyByClient.get(c.id);
              return (
                <TRow key={c.id}>
                  <Td>
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-bold hover:text-brand"
                    >
                      {c.name}
                    </Link>
                    {c.industry && (
                      <span className="ml-2 text-2xs text-fg-subtle">
                        {c.industry}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-fg">{c.activeProjects} live</span>
                    {c.totalProjects > c.activeProjects && (
                      <span className="text-fg-subtle">
                        {" "}
                        · {c.totalProjects} total
                      </span>
                    )}
                  </Td>
                  <Td numeric>
                    {hrs(Number(c.loggedHours))}h
                  </Td>
                  {seesMoney && (
                    <Td numeric>
                      {m?.revenueAmount
                        ? fmtMoney(Number(m.revenueAmount), m.currency)
                        : "—"}
                    </Td>
                  )}
                  {seesMoney && (
                    <Td numeric>
                      {m?.costAmount
                        ? fmtMoney(Number(m.costAmount), m.currency)
                        : "—"}
                    </Td>
                  )}
                  <Td numeric>
                    {c.lastActivityAt ? fmtDate(new Date(`${c.lastActivityAt}T00:00:00Z`)) : "—"}
                  </Td>
                </TRow>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
