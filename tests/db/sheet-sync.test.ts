import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { sheets_v4 } from "googleapis";
import { __setSheetsClientForTests } from "@/server/sheets";
import { runSyncWorker } from "@/server/sync-worker";
import { enqueueSheetWrite } from "@/server/sheet-sync";
import { db } from "@/db";
import {
  FIRST_DATA_ROW,
  formatSheetDate,
  headerHash,
} from "@/lib/sheet-template";
import {
  jobStatuses,
  makeConnection,
  makeProject,
  makeUser,
  makeWorkLog,
  owner,
  queueJob,
  resetDb,
} from "./harness";

/**
 * The sync worker's state machine, against a real database and a fake Google.
 *
 * The Sheets API itself is not what needs testing here — Google's client works.
 * What needs testing is everything around it, and none of it is reachable
 * without a database: which rows get claimed, how many API calls a batch costs,
 * whether a stale row hint is repaired, and what happens to the connection when
 * a sheet stops accepting writes. All of that would otherwise only ever be
 * exercised by hand against a live spreadsheet.
 */

/** Records every call so the test can assert on shape and on COUNT. */
type Call = { method: string; args: Record<string, unknown> };

/** The layout the team uses: a label in B, filled in per sheet. */
const HEADERS = [
  "Date",
  "Dr V Clinic",
  "Hours",
  "Notes — Work Done",
  "Link (if any)",
  "Work Log ID",
];

function fakeSheets(opts: {
  headers?: string[];
  idColumn?: string[];
  /** Tabs the spreadsheet already has. Anything else gets created. */
  tabs?: string[];
  /** Thrown by the next write, to simulate Google refusing. */
  failWith?: { code: number; message: string };
}) {
  const calls: Call[] = [];
  const headers = opts.headers ?? HEADERS;
  const idColumn = opts.idColumn ?? [];
  const tabs = new Set(opts.tabs ?? ["September 2026"]);

  const maybeFail = () => {
    if (opts.failWith) {
      const err = new Error(opts.failWith.message) as Error & { code: number };
      err.code = opts.failWith.code;
      throw err;
    }
  };

  const client = {
    spreadsheets: {
      get: async () => {
        calls.push({ method: "meta", args: {} });
        return {
          data: {
            properties: { title: "Tracker" },
            sheets: [...tabs].map((title, i) => ({
              properties: { title, sheetId: i + 1 },
            })),
          },
        };
      },
      // addSheet for a new month, and hiding the id column.
      batchUpdate: async (args: { requestBody: { requests: unknown[] } }) => {
        calls.push({ method: "sheetsBatchUpdate", args });
        const add = (
          args.requestBody.requests as {
            addSheet?: { properties: { title: string } };
          }[]
        ).find((r) => r.addSheet);
        if (add?.addSheet) {
          tabs.add(add.addSheet.properties.title);
          return {
            data: {
              replies: [
                { addSheet: { properties: { sheetId: tabs.size + 10 } } },
              ],
            },
          };
        }
        return { data: {} };
      },
      values: {
        get: async (args: { range: string }) => {
          calls.push({ method: "get", args });
          // The header sits under the banner, on row 8.
          const isHeader = /!8:8$/.test(args.range);
          return {
            data: {
              values: isHeader ? [headers] : idColumn.map((v) => [v]),
            },
          };
        },
        // Writes the banner into a new tab, and the id heading into an adopted one.
        update: async (args: unknown) => {
          calls.push({ method: "update", args: args as Record<string, unknown> });
          return { data: {} };
        },
        append: async (args: { requestBody: { values: string[][] } }) => {
          calls.push({ method: "append", args });
          maybeFail();
          const n = args.requestBody.values.length;
          // Google answers with the range it wrote; entries start below the banner.
          const first = idColumn.length + FIRST_DATA_ROW;
          return {
            data: {
              updates: {
                updatedRange: `Sheet1!A${first}:F${first + n - 1}`,
              },
            },
          };
        },
        batchUpdate: async (args: unknown) => {
          calls.push({ method: "batchUpdate", args: args as Record<string, unknown> });
          maybeFail();
          return { data: {} };
        },
      },
    },
  };

  return { client: client as unknown as sheets_v4.Sheets, calls };
}

const validHash = headerHash(HEADERS);

async function scenario(
  overrides: {
    headerHash?: string | null;
    visibility?: "internal" | "shareable";
  } = {},
) {
  const userId = await makeUser({ name: "Ahmed" });
  const projectId = await makeProject({ code: "TS-001" });
  const connectionId = await makeConnection({
    projectId,
    headerHash:
      overrides.headerHash === undefined ? validHash : overrides.headerHash,
    visibility: overrides.visibility,
  });
  return { userId, projectId, connectionId };
}

beforeEach(resetDb);
afterEach(() => __setSheetsClientForTests(null));
afterAll(async () => {
  await owner.end();
});

describe("appending", () => {
  it("writes one row per entry, in template order", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({
      projectId,
      userId,
      hours: "2.50",
      notes: "Fixed responsive layout",
      workDate: "2026-09-02",
      status: "in_progress",
    });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);

    const result = await runSyncWorker();
    expect(result).toMatchObject({ done: 1, failed: 0 });

    const append = calls.find((c) => c.method === "append")!;
    const row = (append.args as { requestBody: { values: string[][] } })
      .requestBody.values[0];

    // The team's layout: date, their project label, hours, notes, link, id.
    expect(row[0]).toBe(formatSheetDate(new Date("2026-09-02T12:00:00Z")));
    expect(row[1]).toBe(""); // the label column is theirs, not Tavren's
    expect(row[2]).toBe("2.50");
    expect(row[3]).toBe("Fixed responsive layout");
    expect(row[4]).toBe(""); // "Link (if any)" is theirs too
    // Column F addresses the row for every later correction.
    expect(row[5]).toBe(log.id);
  });

  it("records where the row landed, so a correction can find it", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    __setSheetsClientForTests(fakeSheets({}).client);
    await runSyncWorker();

    const links = await owner`
      SELECT row_number FROM sheet_row_links WHERE work_log_id = ${log.id}`;
    expect(links).toHaveLength(1);
  });

  it("costs ONE api call for a batch of entries, not one each", async () => {
    // The whole reason the worker groups by connection. A per-job call would
    // put a backfill straight into the rate limit.
    const { userId, projectId, connectionId } = await scenario();
    for (let i = 0; i < 12; i++) {
      const log = await makeWorkLog({ projectId, userId, hours: "1.00" });
      await queueJob({ connectionId, workLogId: log.id, jobType: "append" });
    }

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    const result = await runSyncWorker();

    expect(result).toMatchObject({ done: 12 });
    expect(calls.filter((c) => c.method === "append")).toHaveLength(1);
  });

  it("withholds the work note when the sheet may be shared", async () => {
    const { userId, projectId, connectionId } = await scenario({
      visibility: "shareable",
    });
    const log = await makeWorkLog({ projectId, userId, notes: "Client is slow" });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const row = (
      calls.find((c) => c.method === "append")!.args as {
        requestBody: { values: string[][] };
      }
    ).requestBody.values[0];
    expect(row[3]).toBe("");
    // The hours still go across; only the note is withheld.
    expect(row[2]).toBe("2.50");
  });
});

describe("corrections", () => {
  it("updates the row the id column points at, not the remembered number", async () => {
    // Somebody inserted two rows at the top, so every stored position is stale.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId, hours: "3.00" });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, ${FIRST_DATA_ROW})`;
    await queueJob({ connectionId, workLogId: log.id, jobType: "update" });

    const { client, calls } = fakeSheets({
      idColumn: ["other-a", "other-b", log.id],
    });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const update = calls.find((c) => c.method === "batchUpdate")!;
    const range = (
      update.args as { requestBody: { data: { range: string }[] } }
    ).requestBody.data[0].range;
    // Third id in the column, so the third data row — not the remembered one.
    expect(range).toContain(`A${FIRST_DATA_ROW + 2}:F${FIRST_DATA_ROW + 2}`);

    const [link] = (await owner`
      SELECT row_number FROM sheet_row_links WHERE work_log_id = ${log.id}`) as unknown as {
      row_number: number;
    }[];
    expect(link.row_number).toBe(FIRST_DATA_ROW + 2);
  });

  it("blanks a removed entry instead of deleting its row", async () => {
    // Deleting a row shifts every row below it and invalidates every hint at
    // once; the reversal also matches what the database itself records.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId, hours: "4.00" });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, ${FIRST_DATA_ROW})`;
    await queueJob({ connectionId, workLogId: log.id, jobType: "delete" });

    const { client, calls } = fakeSheets({ idColumn: [log.id] });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const cells = (
      calls.find((c) => c.method === "batchUpdate")!.args as {
        requestBody: { data: { values: string[][] }[] };
      }
    ).requestBody.data[0].values[0];

    expect(cells[2]).toBe("0.00");
    // No status column on this layout, so the note says it was withdrawn.
    expect(cells[3]).toContain("removed");
    expect(cells[5]).toBe(log.id);
  });

  it("skips an entry whose row a human deleted, rather than guessing", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, ${FIRST_DATA_ROW + 3})`;
    await queueJob({ connectionId, workLogId: log.id, jobType: "update" });

    // The id is nowhere in the sheet any more.
    const { client, calls } = fakeSheets({ idColumn: ["someone-else"] });
    __setSheetsClientForTests(client);
    const result = await runSyncWorker();

    // Nothing written, and the job is not left to retry forever.
    const writes = calls.filter((c) => c.method === "batchUpdate");
    expect(writes.every((w) => {
      const data = (w.args as { requestBody: { data: unknown[] } }).requestBody.data;
      return data.length === 0;
    })).toBe(true);
    expect(result).toMatchObject({ done: 1 });
  });

  it("reads the id column once for a batch, not once per correction", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const log = await makeWorkLog({ projectId, userId });
      ids.push(log.id);
      await owner`
        INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
        VALUES (${connectionId}, ${log.id}, ${i + FIRST_DATA_ROW})`;
      await queueJob({ connectionId, workLogId: log.id, jobType: "update" });
    }

    const { client, calls } = fakeSheets({ idColumn: ids });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    // One header read plus one id-column read for the whole group.
    expect(calls.filter((c) => c.method === "get")).toHaveLength(2);
    expect(calls.filter((c) => c.method === "batchUpdate")).toHaveLength(1);
  });
});

describe("when the sheet stops being writable", () => {
  it("refuses to write at all once a column has been inserted", async () => {
    // The corruption this exists to prevent: with a column inserted, Hours
    // would land in the Work Done column, one row at a time, silently.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({
      headers: ["Date", "Dr V Clinic", "Client", "Hours", "Notes — Work Done"],
    });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    expect(calls.filter((c) => c.method === "append")).toHaveLength(0);

    const [conn] = (await owner`
      SELECT status, error_message FROM sheet_connections WHERE id = ${connectionId}`) as unknown as {
      status: string;
      error_message: string;
    }[];
    expect(conn.status).toBe("error");
    // B is the sheet's own label and is skipped, so the first fixed column
    // that no longer lines up is C.
    expect(conn.error_message).toContain("Column C");
  });

  it("stops when the header row is renamed after connecting", async () => {
    const { userId, projectId, connectionId } = await scenario({
      headerHash: "a-hash-from-a-different-layout",
    });
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    expect(calls.filter((c) => c.method === "append")).toHaveLength(0);
    const statuses = await jobStatuses(connectionId);
    expect(statuses[0].status).toBe("failed");
  });

  it("gives up on a revoked share and makes it somebody's problem", async () => {
    const { userId, projectId, connectionId } = await scenario();
    await makeUser({ name: "Admin", role: "admin" });
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client } = fakeSheets({
      failWith: { code: 403, message: "The caller does not have permission" },
    });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    // 403 is not retryable: retrying a permissions problem never fixes it.
    const statuses = await jobStatuses(connectionId);
    expect(statuses[0].status).toBe("failed");

    const [conn] = (await owner`
      SELECT status FROM sheet_connections WHERE id = ${connectionId}`) as unknown as {
      status: string;
    }[];
    expect(conn.status).toBe("error");

    // A stale sheet nobody is told about is the failure this guards against.
    const notes = await owner`
      SELECT kind, is_actionable FROM notifications WHERE kind = 'sync_failed'`;
    expect(notes.length).toBeGreaterThan(0);
  });

  it("retries a rate limit rather than failing it", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client } = fakeSheets({
      failWith: { code: 429, message: "Quota exceeded" },
    });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const statuses = await jobStatuses(connectionId);
    expect(statuses[0].status).toBe("queued");
    expect(statuses[0].last_error).toContain("Quota");

    // And it is reported as a retry, not a failure: the cron output is the
    // only thing watching this, so it must not cry wolf over a rate limit.
    const result = await runSyncWorker();
    expect(result).toMatchObject({ failed: 0 });
  });
});

describe("connection state", () => {
  it("holds the backlog while a connection is paused", async () => {
    const { userId, projectId, connectionId } = await scenario();
    await owner`
      UPDATE sheet_connections SET status = 'paused' WHERE id = ${connectionId}`;
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    expect(calls.filter((c) => c.method === "append")).toHaveLength(0);
    // Queued, not dropped: resuming must deliver what accumulated.
    const statuses = await jobStatuses(connectionId);
    expect(statuses[0].status).toBe("queued");
  });

  it("drops work for an archived connection instead of retrying forever", async () => {
    const { userId, projectId, connectionId } = await scenario();
    await owner`
      UPDATE sheet_connections SET status = 'archived' WHERE id = ${connectionId}`;
    const log = await makeWorkLog({ projectId, userId });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    __setSheetsClientForTests(fakeSheets({}).client);
    await runSyncWorker();

    const statuses = await jobStatuses(connectionId);
    expect(statuses[0].status).toBe("done");
    expect(statuses[0].last_error).toContain("archived");
  });
});

describe("one sheet per project", () => {
  /** Queues an entry the way recordWorkInTx does. */
  const enqueue = (projectId: string, log: { id: string; revisionId: string }) =>
    db.transaction((tx) =>
      enqueueSheetWrite(tx, {
        projectId,
        workLogId: log.id,
        jobType: "append",
        changeKey: `revision:${log.revisionId}`,
      }),
    );

  it("collects both developers' work on a project into the one sheet", async () => {
    // Who did it is on the work log and shown in the app; the sheet records
    // what was done and how long it took.
    const ahmed = await makeUser({ name: "Ahmed" });
    const ali = await makeUser({ name: "Ali" });
    const projectId = await makeProject({ code: "TS-001" });
    await makeConnection({ projectId, spreadsheetId: "project-sheet", headerHash: validHash });

    const a = await makeWorkLog({ projectId, userId: ahmed, hours: "3.00" });
    const b = await makeWorkLog({ projectId, userId: ali, hours: "5.00" });
    expect(await enqueue(projectId, a)).toBe(true);
    expect(await enqueue(projectId, b)).toBe(true);

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    // One sheet, one call, both rows.
    const appends = calls.filter((c) => c.method === "append");
    expect(appends).toHaveLength(1);
    const rows = (
      appends[0].args as { requestBody: { values: string[][] } }
    ).requestBody.values;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r[2]))).toEqual(new Set(["3.00", "5.00"]));
  });

  it("keeps two projects' work apart", async () => {
    const ahmed = await makeUser({ name: "Ahmed" });
    const projectA = await makeProject({ code: "AAA-1" });
    const projectB = await makeProject({ code: "BBB-2" });
    await makeConnection({ projectId: projectA, spreadsheetId: "a-sheet", headerHash: validHash });
    await makeConnection({ projectId: projectB, spreadsheetId: "b-sheet", headerHash: validHash });

    await enqueue(projectA, await makeWorkLog({ projectId: projectA, userId: ahmed, hours: "1.00" }));
    await enqueue(projectB, await makeWorkLog({ projectId: projectB, userId: ahmed, hours: "7.00" }));

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const bySheet = new Map(
      calls
        .filter((c) => c.method === "append")
        .map((a) => {
          const args = a.args as {
            spreadsheetId: string;
            requestBody: { values: string[][] };
          };
          return [args.spreadsheetId, args.requestBody.values];
        }),
    );
    expect(bySheet.get("a-sheet")![0][2]).toBe("1.00");
    expect(bySheet.get("b-sheet")![0][2]).toBe("7.00");
  });

  it("queues nothing for a project with no sheet", async () => {
    const ahmed = await makeUser({ name: "Ahmed" });
    const projectId = await makeProject({ code: "TS-001" });
    const log = await makeWorkLog({ projectId, userId: ahmed });
    expect(await enqueue(projectId, log)).toBe(false);
    expect(await owner`SELECT id FROM sync_jobs`).toHaveLength(0);
  });

  it("does not send one project's work to another project's sheet", async () => {
    const ahmed = await makeUser({ name: "Ahmed" });
    const mine = await makeProject({ code: "AAA-1" });
    const theirs = await makeProject({ code: "BBB-2" });
    await makeConnection({ projectId: theirs, headerHash: validHash });

    const log = await makeWorkLog({ projectId: mine, userId: ahmed });
    expect(await enqueue(mine, log)).toBe(false);
    expect(await owner`SELECT id FROM sync_jobs`).toHaveLength(0);
  });
});

describe("monthly tabs", () => {
  it("creates the month's tab, with its banner, on the first entry", async () => {
    const { userId, projectId, connectionId } = await scenario();
    // The sheet only has August; this entry is September's.
    const log = await makeWorkLog({ projectId, userId, workDate: "2026-09-15" });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({ tabs: ["August 2026"] });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const added = calls.find(
      (c) =>
        c.method === "sheetsBatchUpdate" &&
        JSON.stringify(c.args).includes("September 2026"),
    );
    expect(added).toBeDefined();

    // And the banner is written, with the totals as live formulas.
    const banner = calls.find(
      (c) => c.method === "update" && JSON.stringify(c.args).includes("SUM("),
    );
    expect(banner).toBeDefined();
  });

  it("routes an entry to the tab for its own work date, not for today", async () => {
    // A correction filed in September to August's work belongs in August.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId, workDate: "2026-08-14" });
    await queueJob({ connectionId, workLogId: log.id, jobType: "append" });

    const { client, calls } = fakeSheets({ tabs: ["August 2026", "September 2026"] });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const append = calls.find((c) => c.method === "append")!;
    expect((append.args as { range: string }).range).toContain("August 2026");
  });

  it("splits a batch that straddles a month boundary", async () => {
    const { userId, projectId, connectionId } = await scenario();
    for (const workDate of ["2026-08-31", "2026-09-01"]) {
      const log = await makeWorkLog({ projectId, userId, workDate });
      await queueJob({ connectionId, workLogId: log.id, jobType: "append" });
    }

    const { client, calls } = fakeSheets({ tabs: ["August 2026", "September 2026"] });
    __setSheetsClientForTests(client);
    const result = await runSyncWorker();

    expect(result).toMatchObject({ done: 2 });
    const ranges = calls
      .filter((c) => c.method === "append")
      .map((c) => (c.args as { range: string }).range);
    expect(ranges).toHaveLength(2);
    expect(ranges.some((r) => r.includes("August 2026"))).toBe(true);
    expect(ranges.some((r) => r.includes("September 2026"))).toBe(true);
  });
});
