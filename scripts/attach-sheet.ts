/**
 * Attaches a spreadsheet to a project so work logs start syncing to it.
 *
 *   pnpm sheets:attach <projectCode> <spreadsheetId> [tabName] [append|update]
 *
 * Guesses the column mapping from the sheet's own header row and prints it for
 * confirmation. Re-running replaces the existing mapping for that project.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { projects, sheetMappings } from "../src/db/schema";
import { readHeaderRow } from "../src/server/sheets";

/** Header text -> Tavren field. Matched loosely because client sheets say
 *  "Hrs", "Time Spent" and "Hours" for the same column. */
const GUESSES: [RegExp, string][] = [
  [/date|day/i, "date"],
  [/task|item|deliverable|description of work/i, "taskTitle"],
  [/dev|who|resource|assignee|name/i, "developer"],
  [/hour|hrs|time/i, "hours"],
  [/note|comment|detail|remark/i, "notes"],
  [/status|state|progress/i, "status"],
];

async function main() {
  const [code, spreadsheetId, tabArg, modeArg] = process.argv.slice(2);
  if (!code || !spreadsheetId) {
    console.error(
      "Usage: pnpm sheets:attach <projectCode> <spreadsheetId> [tabName] [append|update]",
    );
    process.exit(1);
  }
  const mode = (modeArg ?? "append") as "append" | "update";

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.code, code.toUpperCase()));
  if (!project) {
    console.error(`No project with code ${code}.`);
    process.exit(1);
  }

  const sheetName = tabArg ?? "Sheet1";
  const headers = await readHeaderRow({ spreadsheetId, sheetName, headerRow: 1 });

  const columnMap: Record<string, string> = {};
  for (const h of headers) {
    for (const [re, field] of GUESSES) {
      if (!columnMap[field] && re.test(h.label)) {
        columnMap[field] = h.column;
        break;
      }
    }
  }
  // An append-only log with no headers still needs somewhere to put the values.
  if (Object.keys(columnMap).length === 0) {
    Object.assign(columnMap, {
      date: "A", taskTitle: "B", developer: "C",
      hours: "D", notes: "E", status: "F",
    });
    console.log("No headers matched — falling back to the default A–F layout.");
  }

  await db
    .insert(sheetMappings)
    .values({ projectId: project.id, spreadsheetId, sheetName, mode, columnMap })
    .onConflictDoUpdate({
      target: sheetMappings.projectId,
      set: { spreadsheetId, sheetName, mode, columnMap, isEnabled: true },
    });

  console.log(`\nAttached to ${project.name} (${code.toUpperCase()})`);
  console.log(`  tab:  ${sheetName}`);
  console.log(`  mode: ${mode}`);
  console.log("  columns:");
  for (const [field, col] of Object.entries(columnMap)) {
    const label = headers.find((h) => h.column === col)?.label ?? "(no header)";
    console.log(`    ${field.padEnd(10)} -> ${col}  "${label}"`);
  }
  console.log("\nCheck the mapping above. Fix it with SQL if a column is wrong.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
