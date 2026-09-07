import Link from "next/link";
import { asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, sheetConnections } from "@/db/schema";
import { requireCapability } from "@/lib/authz";
import { SectionIntro } from "@/components/app-shell";
import { Badge } from "@/components/badges";

/**
 * Every work-log sheet, across every project.
 *
 * Read-only on purpose. A sheet belongs to a project and is attached on that
 * project's own Sheet tab. This page answers the question no single project
 * can: which projects are still logging into nothing, and which sheets have
 * stopped accepting writes.
 */

export default async function SheetsAdminPage() {
  /**
   * Gated on seeing every project, because that is what this page is: the code
   * and name of every project in the company, listed regardless of who is
   * looking. Everywhere else, project visibility is earned by membership —
   * `canAccessProject` exists precisely to stop someone reading a project they
   * are not on. This page bypassed all of it by never asking who was asking.
   *
   * Not `sheet.configure`: a PM holds that on their own project, and nothing
   * about running one project justifies a roster of all the others.
   */
  await requireCapability("project.viewAll");

  const [rows] = await Promise.all([
    db
      .select({
        connectionId: sheetConnections.id,
        status: sheetConnections.status,
        spreadsheetUrl: sheetConnections.spreadsheetUrl,
        lastSyncAt: sheetConnections.lastSyncAt,
        projectId: projects.id,
        projectCode: projects.code,
        projectName: projects.name,
      })
      .from(sheetConnections)
      .innerJoin(projects, eq(sheetConnections.projectId, projects.id))
      .where(ne(sheetConnections.status, "archived"))
      .orderBy(asc(projects.code)),
  ]);

  const broken = rows.filter((r) => r.status === "error").length;

  return (
    <>
      <SectionIntro
        eyebrow="ONE SHEET PER PROJECT"
        title="Every sheet Tavren writes to"
        description="Attached on each project's own Sheet tab. This page is the list, and
                     what has stopped working."
      />

      {broken > 0 && (
        <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-xs font-medium text-danger">
          {broken} {broken === 1 ? "sheet has" : "sheets have"} stopped
          accepting updates. Until fixed, that work is recorded in Tavren but
          not mirrored.
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">CONNECTED</p>
            <h3 className="m-0 text-base tracking-[-.03em]">
              {rows.length} {rows.length === 1 ? "sheet" : "sheets"}
            </h3>
          </div>
        </div>
        <div className="px-5 py-1">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-xs text-fg-muted">
              No sheets attached yet. Open a project and go to its Sheet tab.
            </p>
          ) : (
            rows.map((r) => (
              <div
                key={r.connectionId}
                className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold">{r.projectCode}</div>
                  <div className="truncate text-2xs text-fg-subtle">
                    {r.projectName}
                  </div>
                </div>

                {r.status === "error" ? (
                  <Badge tone="red">Not syncing</Badge>
                ) : r.status === "paused" ? (
                  <Badge tone="neutral">Paused</Badge>
                ) : (
                  <Badge tone="green">Syncing</Badge>
                )}

                <a
                  href={r.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-2xs font-bold text-fg-muted hover:text-fg"
                >
                  Open
                </a>
                <Link
                  href={`/projects/${r.projectId}?tab=sheet`}
                  className="btn-secondary btn-sm"
                >
                  Manage
                </Link>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
