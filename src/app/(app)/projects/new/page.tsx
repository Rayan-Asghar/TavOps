import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { SectionIntro } from "@/components/app-shell";
import { ProjectForm } from "@/components/project-form";


export const metadata = { title: "New project" };
export default async function NewProjectPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "project.create")) notFound();

  const [clientRows, staff] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(clients.name),
    db
      .select({ id: users.id, name: users.name, role: users.globalRole })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.name),
  ]);

  const pick = (...roles: string[]) =>
    staff.filter((u) => roles.includes(u.role)).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <SectionIntro
        eyebrow="DELIVERY CONTROL"
        title="New project"
        description="For work that did not come through the sales pipeline — retainers, internal builds, referrals. Deals won on Upwork are converted from Sales so nothing is retyped."
      />
      <ProjectForm
        clients={clientRows}
        pms={pick("head", "admin")}
        leads={pick("head")}
        salesPeople={pick("sales", "head")}
        developers={staff
          .filter((u) => u.role === "developer" || u.role === "collaborator")
          .map(({ id, name, role }) => ({ id, name, globalRole: role }))}
      />
    </>
  );
}
