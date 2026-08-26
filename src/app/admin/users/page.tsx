import { notFound, redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { unresolvedCount } from "@/server/notifications";
import { ROLE_DESCRIPTIONS } from "@/server/user-schemas";
import { AppShell } from "@/components/app-shell";
import { Badge, type Tone } from "@/components/badges";
import { CreateUserForm } from "@/components/create-user-form";
import { UserRowActions } from "@/components/user-row-actions";

const ROLE_TONE: Record<string, Tone> = {
  admin: "red",
  pm: "violet",
  delivery_lead: "blue",
  sales_head: "violet",
  sales: "blue",
  developer: "neutral",
  collaborator: "amber",
};

function labelFor(role: string) {
  return role
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

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

  const [people, count] = await Promise.all([
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
    unresolvedCount(actor.id),
  ]);

  const [{ activeAdmins }] = await db
    .select({ activeAdmins: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.globalRole} = 'admin' and ${users.isActive} = true`);

  const now = new Date();
  const active = people.filter((p) => p.isActive);
  const inactive = people.filter((p) => !p.isActive);

  return (
    <AppShell userName={me?.name ?? "Admin"} userRole={role} inboxCount={count}>
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-fg-subtle">
        Admin <span className="mx-1">/</span>
        <span className="text-fg-muted">People</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">People</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {active.length} active
          {inactive.length > 0 && `, ${inactive.length} deactivated`}. Accounts
          are never deleted — their logged hours have to stay attributable.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
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
                  className={`card p-4 ${p.isActive ? "" : "opacity-60"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{p.name}</span>
                        <Badge tone={ROLE_TONE[p.globalRole] ?? "neutral"}>
                          {labelFor(p.globalRole)}
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
                </li>
              );
            })}
          </ul>
        </section>

        <aside>
          <CreateUserForm />
        </aside>
      </div>
    </AppShell>
  );
}
