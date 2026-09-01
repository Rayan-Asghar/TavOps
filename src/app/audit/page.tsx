import { notFound, redirect } from "next/navigation";
import { and, count as countRows, desc, eq, ilike, isNull, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, projects, users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { accessibleProjectIds } from "@/lib/access";
import { unresolvedCount } from "@/server/notifications";
import { AppShell, SectionIntro } from "@/components/app-shell";

import { fmtDateTime } from "@/lib/format";
import {
  EmptyRow,
  FilterSelect,
  ListFilters,
  Pagination,
} from "@/components/ui";
import {
  offsetFor,
  pageInfo,
  parseListParams,
  type RawParams,
} from "@/lib/list-params";

export const metadata = { title: "Audit log" };
const PAGE_SIZE = 50;

/** "work_log.edit" -> "Work log edited" reads better than a dotted verb. */
const ACTION_LABELS: Record<string, string> = {
  "work_log.create": "Work logged",
  "work_log.edit": "Work log corrected",
  "work_log.delete": "Work log removed",
  "task.create": "Task created",
  "task.update": "Task updated",
  "review.submit": "Review decided",
  "blocker.report": "Blocker reported",
  "blocker.resolve": "Blocker resolved",
  "project.create": "Project created",
  "project.activate": "Project activated",
};


/**
 * Renders a before/after pair as the fields that actually moved.
 *
 * Showing both blobs side by side means reading two JSON objects to find the
 * one number that changed, which is the work this page exists to save.
 */
function diffLines(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { key: string; from?: string; to?: string }[] {
  const show = (v: unknown) =>
    v === null || v === undefined ? "—" : String(v);

  if (!before) {
    return Object.entries(after ?? {}).map(([key, v]) => ({
      key,
      to: show(v),
    }));
  }

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after ?? {})])];
  return keys
    .filter((k) => show(before[k]) !== show(after?.[k]))
    .map((k) => ({ key: k, from: show(before[k]), to: show(after?.[k]) }));
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  if (!can(role, "audit.view")) notFound();

  // audit.view is admin/head today, and both see every project — so this is
  // normally unrestricted. Scoping anyway means widening the capability later
  // does not silently hand somebody another project's history. Entries with no
  // project (user and team administration) are never project-scoped.
  const scope = await accessibleProjectIds(actor);

  const params = await searchParams;
  const list = parseListParams(params, { pageSize: PAGE_SIZE });
  const actionFilter = typeof params.action === "string" ? params.action : "";

  // Scope first, then the user's filters on top — never the other way round.
  const scopeClause =
    scope === null
      ? undefined
      : or(
          isNull(auditLog.projectId),
          inArray(auditLog.projectId, scope.length ? scope : [""]),
        );

  const searchClause = list.q
    ? or(
        ilike(users.name, `%${list.q}%`),
        ilike(projects.code, `%${list.q}%`),
        ilike(projects.name, `%${list.q}%`),
        ilike(auditLog.action, `%${list.q}%`),
      )
    : undefined;

  const actionClause =
    actionFilter && actionFilter in ACTION_LABELS
      ? eq(auditLog.action, actionFilter)
      : undefined;

  const where = and(scopeClause, searchClause, actionClause);

  const [rows, [{ total }], count] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        ts: auditLog.ts,
        action: auditLog.action,
        entityType: auditLog.entityType,
        before: auditLog.before,
        after: auditLog.after,
        actorName: users.name,
        projectCode: projects.code,
        projectName: projects.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .leftJoin(projects, eq(auditLog.projectId, projects.id))
      .where(where)
      .orderBy(desc(auditLog.ts))
      .limit(PAGE_SIZE)
      .offset(offsetFor(list)),
    // Counted through the same joins and the same where, so the pager can
    // never disagree with the rows it is paging.
    db
      .select({ total: countRows() })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .leftJoin(projects, eq(auditLog.projectId, projects.id))
      .where(where),
    unresolvedCount(actor.id),
  ]);

  const info = pageInfo(list, Number(total));

  return (
    <AppShell
      userName={me?.name ?? ""}
      userRole={role}
      inboxCount={count}
      title="Audit log"
    >
      <SectionIntro
        eyebrow="APPEND-ONLY RECORD"
        title="What changed, who changed it, and when"
        description="Written in the same transaction as the change itself, and the
                     app role cannot update or delete these rows."
      />

      <ListFilters
        action="/audit"
        params={params}
        active={list}
        placeholder="Person, project or action"
      >
        <FilterSelect
          name="action"
          label="Action"
          value={actionFilter}
          options={Object.entries(ACTION_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </ListFilters>

      <section className="panel mt-4">
        <div className="px-5 py-1">
          {rows.length === 0 ? (
            <EmptyRow>
              {list.q || actionFilter
                ? "Nothing matches those filters."
                : "Nothing recorded yet."}
            </EmptyRow>
          ) : (
            rows.map((r) => {
              const changes = diffLines(r.before, r.after);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-1 gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[130px_1fr] sm:gap-3"
                >
                  <div>
                    <div className="text-xs font-bold">{fmtDateTime(r.ts)}</div>
                    <div className="text-2xs text-fg-subtle">
                      {r.actorName ?? "system"}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <strong className="text-xs">
                        {ACTION_LABELS[r.action] ?? r.action}
                      </strong>
                      {r.projectCode && (
                        <span className="text-2xs text-fg-muted">
                          {r.projectCode} · {r.projectName}
                        </span>
                      )}
                    </div>

                    {changes.length > 0 && (
                      <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                        {changes.map((c) => (
                          <li
                            key={c.key}
                            className="font-mono text-2xs text-fg-muted"
                          >
                            <span className="text-fg-subtle">{c.key}</span>{" "}
                            {c.from !== undefined && (
                              <>
                                <span className="line-through">{c.from}</span>
                                {" → "}
                              </>
                            )}
                            <span className="text-fg">{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <Pagination info={info} pathname="/audit" params={params} unit="entries" />
      </section>
    </AppShell>
  );
}
