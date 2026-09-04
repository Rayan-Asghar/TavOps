import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, withFinanceAccess } from "@/db";
import { userRates, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ROLE_DESCRIPTIONS } from "@/server/user-schemas";
import { SectionIntro } from "@/components/app-shell";
import { Badge } from "@/components/badges";
import { CreateUserForm } from "@/components/create-user-form";
import { UserRowActions } from "@/components/user-row-actions";
import { RateCell, type CurrentRate } from "@/components/rate-cell";



import { GLOBAL_ROLE_TONE, humanizeRole } from "@/lib/tone";

export const metadata = { title: "People" };
export default async function AdminUsersPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  // 404 rather than 403, consistent with the rest of the app: a non-admin
  // should not learn that an admin area exists.
  if (!can(role, "user.manage")) notFound();

  const [people] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        globalRole: users.globalRole,
        isActive: users.isActive,
        accessExpiresAt: users.accessExpiresAt,
        weeklyCapacityHours: users.weeklyCapacityHours,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.isActive), asc(users.name)),
  ]);

  const [{ activeAdmins }] = await db
    .select({ activeAdmins: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.globalRole} = 'admin' and ${users.isActive} = true`);

  /**
   * Rates are read only when the actor may see them, and only inside the
   * finance gate. `rates.view` is admin-only: `head` runs the company and still
   * does not get pay data by inference, which is the rule rbac.ts states and
   * the reason this is a separate check from `user.manage`.
   */
  const canSeeRates = can(role, "rates.view");
  const rates = new Map<string, CurrentRate>();
  if (canSeeRates) {
    const rows = await withFinanceAccess((tx) =>
      tx
        .select({
          userId: userRates.userId,
          internalCostPerHour: userRates.internalCostPerHour,
          billableRatePerHour: userRates.billableRatePerHour,
          currency: userRates.currency,
          effectiveFrom: userRates.effectiveFrom,
        })
        .from(userRates)
        // The open row is the current one; the closed rows are history, and
        // history belongs to the costing snapshot, not to this screen.
        .where(isNull(userRates.effectiveTo)),
    );
    for (const r of rows) {
      rates.set(r.userId, {
        internalCostPerHour: r.internalCostPerHour,
        billableRatePerHour: r.billableRatePerHour,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      });
    }
  }

  const now = new Date();
  const active = people.filter((p) => p.isActive);
  const inactive = people.filter((p) => !p.isActive);

  return (
    <>
      <SectionIntro
        eyebrow="SECURITY & GOVERNANCE"
        title="People"
        description={`${active.length} active${
          inactive.length > 0 ? `, ${inactive.length} deactivated` : ""
        }. Accounts are never deleted — logged hours have to stay attributable.`}
        actions={
          // /admin/teams had no link from anywhere in the app: no nav slot, no
          // in-page link, reachable only by typing the URL. It is reference
          // data now rather than routing, so it belongs next to People.
          <Link href="/admin/teams" className="btn-secondary btn-sm">
            Teams
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="people-heading">
          <h2 id="people-heading" className="sr-only">
            Existing accounts
          </h2>
          <ul className="space-y-2">
            {people.map((p) => {
              const expired =
                !!p.accessExpiresAt && p.accessExpiresAt <= now;
              const expiringSoon =
                !!p.accessExpiresAt &&
                !expired &&
                p.accessExpiresAt.getTime() - now.getTime() < 7 * 864e5;

              return (
                <li
                  key={p.id}
                  className={`panel p-4 ${p.isActive ? "" : "opacity-60"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{p.name}</span>
                        <Badge tone={GLOBAL_ROLE_TONE[p.globalRole] ?? "neutral"}>
                          {humanizeRole(p.globalRole)}
                        </Badge>
                        {!p.isActive && <Badge>Deactivated</Badge>}
                        {expired && <Badge tone="red">Access expired</Badge>}
                        {expiringSoon && (
                          <Badge tone="amber">
                            Expires{" "}
                            {p.accessExpiresAt!.toISOString().slice(0, 10)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-fg-muted">
                        {p.email}
                      </p>
                      <p className="mt-1 text-xs text-fg-subtle">
                        {ROLE_DESCRIPTIONS[p.globalRole]}
                      </p>
                    </div>

                    <UserRowActions
                      userId={p.id}
                      userName={p.name}
                      isActive={p.isActive}
                      isSelf={p.id === actor.id}
                      isLastAdmin={
                        p.globalRole === "admin" && activeAdmins <= 1
                      }
                    />
                  </div>

                  {/* Rendered on the server only for an actor who may see pay
                      data, so an unrendered rate never reaches the browser. */}
                  {canSeeRates && p.isActive && (
                    <RateCell
                      userId={p.id}
                      userName={p.name}
                      rate={rates.get(p.id) ?? null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <aside>
          <CreateUserForm />
        </aside>
      </div>
    </>
  );
}
