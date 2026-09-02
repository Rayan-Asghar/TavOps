import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, sheetConnections, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { templateCopyUrl } from "@/lib/sheet-template";
import { sheetStatusFor } from "@/server/sheet-queries";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";
import { Badge } from "@/components/badges";
import { SheetPanel } from "@/components/sheet-panel";

/**
 * Where work-log sheets are allotted.
 *
 * Two kinds sit side by side because they answer different questions and a
 * person allotting one usually wants to see the other. A project's sheet says
 * what the project cost; a developer's says what that person did, across every
 * project they touched.
 *
 * Reached by heads and admins only. A developer never allots their own sheet —
 * that is the point of it being allotted.
 */

function StatusBadge({
  status,
}: {
  status: "active" | "paused" | "error" | "archived" | null;
}) {
  if (!status || status === "archived") return <Badge tone="neutral">None</Badge>;
  if (status === "error") return <Badge tone="red">Not syncing</Badge>;
  if (status === "paused") return <Badge tone="neutral">Paused</Badge>;
  return <Badge tone="green">Syncing</Badge>;
}

export default async function SheetsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "sheet.configure")) notFound();

  const sp = await searchParams;

  const [people, projectRows, connections, count] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, role: users.globalRole })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.name)),
    db
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(ne(projects.lifecycle, "archived"))
      .orderBy(asc(projects.code)),
    db
      .select({
        id: sheetConnections.id,
        scope: sheetConnections.scope,
        projectId: sheetConnections.projectId,
        userId: sheetConnections.userId,
        status: sheetConnections.status,
        spreadsheetUrl: sheetConnections.spreadsheetUrl,
      })
      .from(sheetConnections)
      .where(ne(sheetConnections.status, "archived")),
    unresolvedCount(actor.id),
  ]);

  const byUser = new Map(
    connections.filter((c) => c.userId).map((c) => [c.userId!, c]),
  );
  const byProject = new Map(
    connections.filter((c) => c.projectId).map((c) => [c.projectId!, c]),
  );

  // The person being allotted a sheet right now, if one was picked.
  const selected = sp.person
    ? (people.find((p) => p.id === sp.person) ?? null)
    : null;
  const selectedStatus = selected
    ? await sheetStatusFor({ scope: "developer", userId: selected.id })
    : null;

  const templateCopyHref = process.env.TAVREN_SHEET_TEMPLATE_ID
    ? templateCopyUrl(process.env.TAVREN_SHEET_TEMPLATE_ID)
    : null;

  return (
    <AppShell
      userName={me?.name ?? ""}
      userRole={role}
      inboxCount={count}
      title="Work log sheets"
    >
      <SectionIntro
        eyebrow="ALLOTTED, NOT CHOSEN"
        title="Which sheet receives whose work"
        description="Every entry is written to its project's sheet and to the person's own
                     sheet. Developers log in Tavren and never pick a sheet, or edit one."
      />

      {selected && selectedStatus ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/admin/sheets" className="btn-secondary btn-sm">
              Back
            </Link>
            <p className="m-0 text-[12px] text-fg-muted">
              Sheet for <b>{selected.name}</b>
            </p>
          </div>
          <SheetPanel
            owner={{ scope: "developer", userId: selected.id }}
            status={selectedStatus}
            serviceAccountEmail={
              process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null
            }
            templateCopyHref={templateCopyHref}
          />
        </div>
      ) : (
        <>
          <section className="panel mb-4">
            <div className="panel-head">
              <div>
                <p className="eyebrow">BY PERSON</p>
                <h3 className="m-0 text-base tracking-[-.03em]">
                  Everything one person did
                </h3>
              </div>
            </div>
            <div className="px-5 py-1">
              {people.map((p) => {
                const conn = byUser.get(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 border-b border-border py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-bold">{p.name}</div>
                      <div className="text-[9px] text-fg-subtle">{p.role}</div>
                    </div>
                    <StatusBadge status={conn?.status ?? null} />
                    {conn && (
                      <a
                        href={conn.spreadsheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-bold text-fg-muted hover:text-fg"
                      >
                        Open
                      </a>
                    )}
                    <Link
                      href={`/admin/sheets?person=${p.id}`}
                      className="btn-secondary btn-sm"
                    >
                      {conn ? "Change" : "Allot a sheet"}
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">BY PROJECT</p>
                <h3 className="m-0 text-base tracking-[-.03em]">
                  Everything done on one project
                </h3>
              </div>
              <span className="text-[11px] text-fg-muted">
                attached on the project&rsquo;s own Sheet tab
              </span>
            </div>
            <div className="px-5 py-1">
              {projectRows.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-fg-muted">
                  No live projects.
                </p>
              ) : (
                projectRows.map((pr) => {
                  const conn = byProject.get(pr.id);
                  return (
                    <div
                      key={pr.id}
                      className="flex items-center gap-3 border-b border-border py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold">{pr.code}</div>
                        <div className="truncate text-[9px] text-fg-subtle">
                          {pr.name}
                        </div>
                      </div>
                      <StatusBadge status={conn?.status ?? null} />
                      {conn && (
                        <a
                          href={conn.spreadsheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-bold text-fg-muted hover:text-fg"
                        >
                          Open
                        </a>
                      )}
                      <Link
                        href={`/projects/${pr.id}?tab=sheet`}
                        className="btn-secondary btn-sm"
                      >
                        {conn ? "Change" : "Attach"}
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
