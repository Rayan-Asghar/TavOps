import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers, teams, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import {
  CreateTeamForm,
  TeamCard,
  type Person,
  type TeamView,
} from "@/components/team-manager";

import { EmptyState } from "@/components/ui";
export default async function TeamsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "team.manage")) notFound();

  const [teamRows, memberRows, staff, count] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.name)),
    db
      .select({
        teamId: teamMembers.teamId,
        id: users.id,
        name: users.name,
        role: users.globalRole,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .orderBy(asc(users.name)),
    db
      .select({ id: users.id, name: users.name, role: users.globalRole })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.name)),
    unresolvedCount(actor.id),
  ]);

  const nameById = new Map(staff.map((s) => [s.id, s.name]));

  const views: TeamView[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    discipline: t.discipline,
    leadId: t.leadId,
    leadName: t.leadId ? (nameById.get(t.leadId) ?? null) : null,
    members: memberRows
      .filter((m) => m.teamId === t.id)
      .map(({ id, name, role }) => ({ id, name, role })),
  }));

  const heads: Person[] = staff.filter(
    (s) => s.role === "head" || s.role === "admin",
  );

  return (
    <AppShell
      userName={me?.name ?? ""}
      userRole={role}
      inboxCount={count}
      title="Teams"
    >
      <SectionIntro
        eyebrow="REFERENCE"
        title="Teams"
        description="Who works with whom. Kept as a record only — nothing in the system behaves differently because of it."
      />

      <div className="mb-4 panel border-l-[3px] border-l-border-strong p-4">
        <p className="eyebrow m-0">FOR REFERENCE ONLY</p>
        <p className="m-0 mt-1 text-xs text-fg-muted">
          Teams used to decide who a blocker escalated to. Blockers now route by
          project role — the sales owner, PM or delivery lead named on the
          project — so nothing here changes what anyone is sent. Editing these is
          safe and has no effect on routing, SLAs or notifications.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {views.length === 0 ? (
            <EmptyState>No teams yet. Create one to the right.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {views.map((t) => (
                <TeamCard key={t.id} team={t} everyone={staff} heads={heads} />
              ))}
            </ul>
          )}
        </div>
        <aside>
          <CreateTeamForm heads={heads} />
        </aside>
      </div>
    </AppShell>
  );
}
