/**
 * Lays out the Tavren work-log template in a spreadsheet you own.
 *
 *   pnpm sheets:template <sheet url or id> [project label]
 *
 * Writes the banner, the live totals, the header on row 8 and the formatting,
 * then hides the id column. Run it against a BLANK spreadsheet — it refuses to
 * touch one that already has anything below the header, because that is a
 * work-log sheet somebody is using and this would overwrite it.
 *
 * Why you create the file and not Tavren: the service account cannot own Drive
 * files, and a sheet it did own would take a team's history with it the day the
 * credentials rotate. A sheet made in your Drive is owned by a person from the
 * moment it exists. This is the same reason the app offers a `/copy` link
 * rather than a "create it for me" button.
 *
 * Steps:
 *   1. Drive -> New -> Google Sheets. Leave it empty.
 *   2. Share it with GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor.
 *   3. pnpm sheets:template <paste the url>
 *   4. In Google, set link sharing to "Anyone with the link -> Viewer", so the
 *      copy button works for whoever is allotting a sheet.
 *   5. Put the id it prints into TAVREN_SHEET_TEMPLATE_ID.
 */
import { google } from "googleapis";
import {
  FIRST_DATA_ROW,
  HEADER_ROW,
  bannerRows,
  monthTabName,
  parseSpreadsheetId,
} from "../src/lib/sheet-template";

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    console.error(
      "Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local first.",
    );
    process.exit(1);
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function main() {
  const [input, labelArg] = process.argv.slice(2);
  if (!input) {
    console.error(
      "Usage: pnpm sheets:template <sheet url or id> [project label]\n\n" +
        "Make a blank Google Sheet in your own Drive, share it with the service\n" +
        "account as Editor, then pass its URL here.",
    );
    process.exit(1);
  }

  const spreadsheetId = parseSpreadsheetId(input);
  if (!spreadsheetId) {
    console.error("That does not look like a Google Sheets link or id.");
    process.exit(1);
  }

  const label = labelArg ?? "Project";
  const sheets = google.sheets({ version: "v4", auth: auth() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const first = meta.data.sheets?.[0]?.properties;
  const sheetId = first?.sheetId ?? 0;
  const tabName = first?.title ?? "Sheet1";

  // Refuse a sheet that is already in use. Laying the banner over somebody's
  // work log would destroy it, and there is no undo through the API.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${FIRST_DATA_ROW}:F`,
  });
  const rows = existing.data.values ?? [];
  if (rows.some((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""))) {
    console.error(
      `"${meta.data.properties?.title}" already has entries below row ${HEADER_ROW}.\n` +
        "That looks like a work-log sheet in use, so nothing was written.\n" +
        "Use a blank spreadsheet for the template.",
    );
    process.exit(1);
  }

  // Name the tab for the current month, so a copy is immediately usable.
  // Tavren adds each later month itself.
  const monthName = monthTabName(new Date());
  if (tabName !== monthName) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, title: monthName },
              fields: "title",
            },
          },
        ],
      },
    });
  }

  // USER_ENTERED so the totals are stored as live formulas rather than as text
  // that happens to begin with "=".
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${monthName}'!A1:F${HEADER_ROW}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: bannerRows(monthName, label) },
  });

  const dark = { red: 0.12, green: 0.12, blue: 0.13 };
  const white = { red: 1, green: 1, blue: 1 };
  const muted = { red: 0.42, green: 0.42, blue: 0.44 };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } },
            },
            fields: "userEnteredFormat.textFormat",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
            cell: {
              userEnteredFormat: {
                textFormat: { italic: true, foregroundColor: muted },
              },
            },
            fields: "userEnteredFormat.textFormat",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 4, endRowIndex: 5 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 9, foregroundColor: muted },
              },
            },
            fields: "userEnteredFormat.textFormat",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 5, endRowIndex: 6 },
            cell: {
              userEnteredFormat: { textFormat: { bold: true, fontSize: 11 } },
            },
            fields: "userEnteredFormat.textFormat",
          },
        },
        // The header row, so it reads as where the table starts.
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: HEADER_ROW - 1,
              endRowIndex: HEADER_ROW,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: dark,
                textFormat: { bold: true, foregroundColor: white },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        // Everything above the log stays put while the log scrolls.
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: HEADER_ROW },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        // Hours read as numbers, so the total is a total.
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: FIRST_DATA_ROW - 1,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: "NUMBER", pattern: "0.00" },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        // Notes wrap rather than spilling across the link column.
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: FIRST_DATA_ROW - 1,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        },
        // Tavren's bookkeeping; nobody needs to see it.
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
          },
        },
        // The note carries the sentence, so it gets the room.
        ...([
          [0, 150],
          [1, 150],
          [2, 90],
          [3, 460],
          [4, 200],
        ] as const).map(([index, pixelSize]) => ({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS" as const,
              startIndex: index,
              endIndex: index + 1,
            },
            properties: { pixelSize },
            fields: "pixelSize",
          },
        })),
      ],
    },
  });

  console.log(`\nLaid out "${meta.data.properties?.title}" as the Tavren template.`);
  console.log(`Tab "${monthName}", header on row ${HEADER_ROW}, id column hidden.\n`);
  console.log(`  TAVREN_SHEET_TEMPLATE_ID="${spreadsheetId}"\n`);
  console.log(`  view  https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  console.log(`  copy  https://docs.google.com/spreadsheets/d/${spreadsheetId}/copy\n`);
  console.log(
    'Last step: in Google, set link sharing to "Anyone with the link -> Viewer",',
  );
  console.log("so the copy button works for whoever is allotting a sheet.");
  process.exit(0);
}

main().catch((err) => {
  const e = err as { code?: number; message?: string };
  if (e.code === 403) {
    console.error(
      "\nThe service account cannot open that sheet.\n" +
        `Share it with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as an Editor and try again.`,
    );
  } else if (e.code === 404) {
    console.error("\nNo sheet found at that link. Check you copied the whole URL.");
  } else {
    console.error("\nFailed:", e.message);
  }
  process.exit(1);
});
