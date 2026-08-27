/**
 * Google Sheets connection doctor.
 *
 * Proves the whole write path end to end against a real spreadsheet before any
 * real work depends on it, and translates Google's errors into the thing you
 * actually need to change.
 *
 *   pnpm sheets:doctor <spreadsheetId> [sheetName]
 *
 * It writes two throwaway rows and deletes them again. Point it at a scratch
 * copy of a client sheet the first time, not the live one.
 */
import {
  a1Range,
  appendRow,
  readHeaderRow,
  sheetsClient,
  updateRowCells,
} from "../src/server/sheets";

const MARKER = "__tavrenops_doctor__";

let failed = false;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string, hint?: string) => {
  failed = true;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (hint) console.log(`     \x1b[33m→ ${hint}\x1b[0m`);
};

/** Maps the errors Google actually returns onto the fix. */
function explain(err: unknown): string {
  const e = err as { code?: number; status?: number; message?: string; errors?: { message?: string }[] };
  const status = e?.code ?? e?.status;
  const msg = e?.message ?? String(err);

  if (msg.includes("invalid_grant"))
    return "The private key is wrong or malformed. Copy `private_key` from the JSON verbatim, keeping the \\n escapes, and wrap it in double quotes.";
  if (msg.includes("Unable to parse range"))
    return "The tab name does not exist in that spreadsheet. Check the tab name at the bottom of the sheet — it is case sensitive.";
  if (msg.includes("has not been used") || msg.includes("is disabled"))
    return "The Sheets API is not enabled on that Google Cloud project. Enable it, then wait a minute.";
  if (status === 403)
    return "The service account cannot open this sheet. Share the spreadsheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor.";
  if (status === 404)
    return "No spreadsheet with that id. Take the id from the URL: docs.google.com/spreadsheets/d/<THIS_PART>/edit";
  if (status === 429)
    return "Rate limited. The sync worker backs off automatically; for this script just retry.";
  return msg;
}

async function main() {
  const spreadsheetId = process.argv[2];
  const wantedTab = process.argv[3];

  console.log("\nTavrenOPS · Google Sheets doctor\n");

  // 1. Credentials present and shaped correctly ---------------------------
  console.log("1. Credentials");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email) bad("GOOGLE_SERVICE_ACCOUNT_EMAIL is empty", "Add it to .env.local");
  else if (!email.endsWith(".gserviceaccount.com"))
    bad(`GOOGLE_SERVICE_ACCOUNT_EMAIL looks wrong: ${email}`, "It should end in .gserviceaccount.com — use client_email from the JSON key, not your own address.");
  else ok(`service account ${email}`);

  if (!key) bad("GOOGLE_PRIVATE_KEY is empty", "Add it to .env.local");
  else if (!key.includes("BEGIN PRIVATE KEY"))
    bad("GOOGLE_PRIVATE_KEY does not contain a PEM block", "Copy the whole `private_key` value including -----BEGIN PRIVATE KEY-----");
  else if (!key.includes("\\n") && !key.includes("\n"))
    bad("GOOGLE_PRIVATE_KEY has no line breaks", "Keep the \\n escapes from the JSON file.");
  else ok("private key looks well formed");

  if (failed || !spreadsheetId) {
    if (!spreadsheetId)
      console.log("\n  Pass a spreadsheet id to test the connection:\n    pnpm sheets:doctor <spreadsheetId> [tabName]\n");
    process.exit(failed ? 1 : 0);
  }

  // 2. Authenticate and open the spreadsheet ------------------------------
  console.log("\n2. Access");
  const sheets = sheetsClient();
  let tab = wantedTab;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean) as string[];
    ok(`opened "${meta.data.properties?.title}"`);
    ok(`tabs: ${tabs.join(", ")}`);

    if (!tab) tab = tabs[0];
    if (!tabs.includes(tab)) {
      bad(`no tab named "${tab}"`, `Available: ${tabs.join(", ")}`);
      process.exit(1);
    }
    ok(`using tab "${tab}" → range ${a1Range(tab, "A:F")}`);
  } catch (err) {
    bad("could not open the spreadsheet", explain(err));
    process.exit(1);
  }

  // 3. Read the header row ------------------------------------------------
  console.log("\n3. Read");
  let headers: { column: string; label: string }[] = [];
  try {
    headers = await readHeaderRow({ spreadsheetId, sheetName: tab!, headerRow: 1 });
    if (headers.length === 0) ok("header row is empty (fine for an append-only log)");
    else ok(`header row: ${headers.map((h) => `${h.column}=${h.label}`).join("  ")}`);
  } catch (err) {
    bad("could not read the header row", explain(err));
    process.exit(1);
  }

  const columnMap = {
    date: "A",
    taskTitle: "B",
    developer: "C",
    hours: "D",
    notes: "E",
    status: "F",
  };

  // 4. Append -------------------------------------------------------------
  console.log("\n4. Append a row");
  try {
    await appendRow({
      spreadsheetId,
      sheetName: tab!,
      columnMap,
      values: {
        date: new Date().toISOString().slice(0, 10),
        taskTitle: MARKER,
        developer: "doctor",
        hours: "0.25",
        notes: "Connection test — safe to delete",
        status: "test",
      },
    });
    ok("append succeeded");
  } catch (err) {
    bad("append failed", explain(err));
    process.exit(1);
  }

  // 5. Read it back, and find which row it landed on -----------------------
  console.log("\n5. Verify");
  let testRow = -1;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1Range(tab!, "A:H"),
    });
    const rows = res.data.values ?? [];
    testRow = rows.findIndex((r) => (r ?? []).includes(MARKER)) + 1;
    if (testRow === 0) {
      bad("the appended row could not be found", "It may have landed on a different tab — check the sheet by eye.");
      process.exit(1);
    }
    ok(`row ${testRow} contains the test values`);
  } catch (err) {
    bad("read-back failed", explain(err));
    process.exit(1);
  }

  // 6. THE IMPORTANT ONE: update must not clobber unmapped columns --------
  console.log("\n6. Update leaves the client's own columns alone");
  const CLIENT_NOTE = "client wrote this";
  try {
    // Put something in an unmapped column, as a client would.
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1Range(tab!, `H${testRow}`),
      valueInputOption: "RAW",
      requestBody: { values: [[CLIENT_NOTE]] },
    });

    await updateRowCells({
      spreadsheetId,
      sheetName: tab!,
      rowNumber: testRow,
      columnMap,
      values: { hours: "1.75", status: "updated" },
    });

    const after = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1Range(tab!, `A${testRow}:H${testRow}`),
    });
    const row = after.data.values?.[0] ?? [];

    if (row[3] !== "1.75") bad(`hours did not update (got "${row[3]}")`);
    else ok("mapped column updated");

    if (row[7] !== CLIENT_NOTE)
      bad(
        `an unmapped column was overwritten (H is now "${row[7]}", expected "${CLIENT_NOTE}")`,
        "This is the bug that loses a client's own notes. Do not sync until it is fixed.",
      );
    else ok("unmapped column H survived — the client's own data is safe");
  } catch (err) {
    bad("update test failed", explain(err));
  }

  // 7. Clean up ------------------------------------------------------------
  console.log("\n7. Clean up");
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: a1Range(tab!, `A${testRow}:H${testRow}`),
    });
    ok(`cleared test row ${testRow}`);
    console.log(
      `\n  \x1b[33mNote:\x1b[0m the row itself remains as a blank line. Delete row ${testRow} by hand if you care.`,
    );
  } catch (err) {
    bad("cleanup failed — remove the test row by hand", explain(err));
  }

  console.log(
    failed
      ? "\n\x1b[31mSome checks failed.\x1b[0m Fix the items above before enabling sync.\n"
      : "\n\x1b[32mAll checks passed.\x1b[0m The sync path works against this spreadsheet.\n",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("\nUnexpected failure:", e);
  process.exit(1);
});
