import { getActor } from "@/lib/auth";
import { accessibleProjectIds } from "@/lib/access";
import { can } from "@/lib/rbac";
import { parseRange, toISODate } from "@/lib/report-range";
import { toCsv } from "@/lib/csv";
import { timesheet } from "@/server/reports";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const HEADERS = [
  "Date",
  "Person",
  "Project code",
  "Project",
  "Task",
  "Hours",
  "Notes",
] as const;

/**
 * The timesheet as a file.
 *
 * A CSV rather than a generated spreadsheet: it opens in whatever the reader
 * already uses, needs no credentials, no external service and no per-row state
 * to keep in sync. The report is produced from Postgres on request and then
 * forgotten, which is the whole point of the direction this app moved in.
 *
 * Scoped exactly as the on-screen report is — the same helpers, so an export
 * can never contain a row the requester could not see in the app.
 */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const role = me?.globalRole ?? "developer";
  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const scope = await accessibleProjectIds(actor);

  // Same rule the project page uses: without worklog.viewAll you get your own
  // entries, on the projects you can reach.
  const rows = await timesheet(range, scope, {
    userId: can(role, "worklog.viewAll") ? null : actor.id,
  });

  const csv = toCsv(
    HEADERS,
    rows.map((r) => [
      toISODate(r.workDate),
      r.personName,
      r.projectCode,
      r.projectName,
      r.taskTitle ?? "General project work",
      r.hours.toFixed(2),
      r.notes,
    ]),
  );

  const filename = `tavren-timesheet-${toISODate(range.from)}-to-${toISODate(range.to)}.csv`;

  return new Response(csv, {
    headers: {
      // charset matters: notes contain em dashes and non-ASCII names.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
