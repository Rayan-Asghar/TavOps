import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { SHEET_COLUMN_ORDER, columnByKey } from "@/lib/grid-columns";
import { loadWorkGrid } from "@/server/grid-queries";
import { UserFacingError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * One month of a project's work log, as a file.
 *
 * Deliberately calls the same `loadWorkGrid` the page calls, with the same URL
 * parameters, so the file cannot disagree with what was on screen and inherits
 * `assertProjectAccess` and the `worklog.viewAll` rule for free — the property
 * the timesheet export states in its own header: an export can never contain a
 * row the requester could not see in the app.
 *
 * The columns are the sheet's, in the sheet's order, so the file opens looking
 * like the tab it came from and a block can be pasted back. The banner rows are
 * NOT reproduced: eight preamble lines make a CSV unreadable to every tool that
 * reads CSVs, so the totals go in a trailing row instead.
 */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const [me] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  const month = url.searchParams.get("month") ?? "";
  const person = url.searchParams.get("person");

  let grid;
  try {
    grid = await loadWorkGrid(actor, me?.globalRole ?? "developer", {
      projectId,
      personId: person,
      month,
    });
  } catch (err) {
    // A scope the requester cannot have is not a server fault, and saying which
    // of the three it was would answer a question they may not ask.
    const status = err instanceof UserFacingError ? 400 : 403;
    return new Response("Not available", { status });
  }

  const headers = SHEET_COLUMN_ORDER.map((key) =>
    key === "label" ? grid.project.name : columnByKey(key).label,
  );

  const rows: unknown[][] = grid.rows.map((r) =>
    SHEET_COLUMN_ORDER.map((key) => {
      switch (key) {
        case "date":
          return r.workDate;
        case "label":
          return "";
        case "hours":
          return r.hours;
        case "notes":
          return r.notes;
        case "link":
          return "";
        case "id":
          return r.id;
        default:
          return "";
      }
    }),
  );

  // A totals line, keyed under the columns it totals rather than as a banner.
  rows.push([]);
  rows.push([
    `${plural(grid.totals.entries, "entry", "entries")} · ${plural(grid.totals.daysLogged, "day", "days")}`,
    "",
    grid.totals.totalHours,
    "",
    "",
    "",
  ]);

  if (grid.truncated) {
    rows.push([`— truncated: this month has more entries than the export returns —`]);
  }

  const who = grid.personId
    ? (grid.people.find((p) => p.id === grid.personId)?.name ?? "person")
    : "all";
  const filename = `tavren-${grid.project.code}-${grid.month}-${who}.csv`
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, "-");

  return new Response(
    // Excel on Windows ignores the charset in Content-Type; the BOM is what
    // makes an em dash or a non-ASCII name survive the round trip.
    "﻿" + toCsv(headers, rows),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        ...(grid.truncated ? { "X-Truncated": "true" } : {}),
      },
    },
  );
}
