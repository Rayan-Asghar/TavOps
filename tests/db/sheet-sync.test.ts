import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { sheets_v4 } from "googleapis";
import { __setSheetsClientForTests } from "@/server/sheets";
import { runSyncWorker } from "@/server/sync-worker";
import { enqueueSheetWrite } from "@/server/sheet-sync";
import { db } from "@/db";
import { TEMPLATE_HEADERS, headerHash } from "@/lib/sheet-template";
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

function fakeSheets(opts: {
  headers?: string[];
  idColumn?: string[];
  /** Thrown by the next write, to simulate Google refusing. */
  failWith?: { code: number; message: string };
}) {
  const calls: Call[] = [];
  const headers = opts.headers ?? [...TEMPLATE_HEADERS];
  const idColumn = opts.idColumn ?? [];

  const maybeFail = () => {
    if (opts.failWith) {
      const err = new Error(opts.failWith.message) as Error & { code: number };
      err.code = opts.failWith.code;
      throw err;
    }
  };

  const client = {
    spreadsheets: {
      values: {
        get: async (args: { range: string }) => {
          calls.push({ method: "get", args });
          // Row 1 is the header read; anything else is the id column.
          const isHeader = /!1:1$/.test(args.range);
          return {
            data: {
              values: isHeader ? [headers] : idColumn.map((v) => [v]),
            },
          };
        },
        append: async (args: { requestBody: { values: string[][] } }) => {
          calls.push({ method: "append", args });
          maybeFail();
          const n = args.requestBody.values.length;
          // Google answers with the range it wrote; rows land after the header.
          const first = idColumn.length + 2;
          return {
            data: {
              updates: {
                updatedRange: `Sheet1!A${first}:H${first + n - 1}`,
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

const validHash = headerHash([...TEMPLATE_HEADERS]);

async function scenario(overrides: Parameters<typeof makeConnection>[0] extends never ? never : {
  headerHash?: string | null;
  visibility?: "internal" | "shareable";
} = {}) {
  const userId = await makeUser({ name: "Ahmed" });
  const projectId = await makeProject({ code: "TS-001" });
  const connectionId = await makeConnection({
    projectId,
    headerHash: overrides.headerHash === undefined ? validHash : overrides.headerHash,
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

    expect(row[0]).toBe("2026-09-02");
    expect(row[1]).toBe("Ahmed");
    expect(row[4]).toBe("2.50");
    expect(row[5]).toBe("Fixed responsive layout");
    expect(row[6]).toBe("in_progress");
    // Column H addresses the row for every later correction.
    expect(row[7]).toBe(log.id);
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
    expect(row[5]).toBe("");
    // Everything else still goes across.
    expect(row[1]).toBe("Ahmed");
  });
});

describe("corrections", () => {
  it("updates the row the id column points at, not the remembered number", async () => {
    // Somebody inserted two rows at the top, so every stored position is stale.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId, hours: "3.00" });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, 2)`;
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
    // Third id in the column, so row 4 — not the remembered row 2.
    expect(range).toContain("A4:H4");

    const [link] = (await owner`
      SELECT row_number FROM sheet_row_links WHERE work_log_id = ${log.id}`) as unknown as {
      row_number: number;
    }[];
    expect(link.row_number).toBe(4);
  });

  it("blanks a removed entry instead of deleting its row", async () => {
    // Deleting a row shifts every row below it and invalidates every hint at
    // once; the reversal also matches what the database itself records.
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId, hours: "4.00" });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, 2)`;
    await queueJob({ connectionId, workLogId: log.id, jobType: "delete" });

    const { client, calls } = fakeSheets({ idColumn: [log.id] });
    __setSheetsClientForTests(client);
    await runSyncWorker();

    const cells = (
      calls.find((c) => c.method === "batchUpdate")!.args as {
        requestBody: { data: { values: string[][] }[] };
      }
    ).requestBody.data[0].values[0];

    expect(cells[4]).toBe("0.00");
    expect(cells[6]).toBe("Removed");
    expect(cells[7]).toBe(log.id);
  });

  it("skips an entry whose row a human deleted, rather than guessing", async () => {
    const { userId, projectId, connectionId } = await scenario();
    const log = await makeWorkLog({ projectId, userId });
    await owner`
      INSERT INTO sheet_row_links (connection_id, work_log_id, row_number)
      VALUES (${connectionId}, ${log.id}, 5)`;
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
        VALUES (${connectionId}, ${log.id}, ${i + 2})`;
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
      headers: ["Date", "Client", ...TEMPLATE_HEADERS.slice(1)],
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
    expect(conn.error_message).toContain("Column B");
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

describe("an entry belongs to two sheets", () => {
  it("writes to the project's sheet AND the developer's", async () => {
    // Neither is a view of the other: they are separate spreadsheets, one
    // answering "what did this project cost", the other "what did Ahmed do".
    const userId = await makeUser({ name: "Ahmed" });
    const projectId = await makeProject({ code: "TS-001" });
    const projectSheet = await makeConnection({
      projectId,
      spreadsheetId: "project-sheet",
      headerHash: validHash,
    });
    const devSheet = await makeConnection({
      userId,
      spreadsheetId: "developer-sheet",
      headerHash: validHash,
    });

    const log = await makeWorkLog({ projectId, userId, hours: "2.50" });
    const queued = await db.transaction((tx) =>
      enqueueSheetWrite(tx, {
        projectId,
        userId,
        workLogId: log.id,
        jobType: "append",
        changeKey: `revision:${log.revisionId}`,
      }),
    );
    expect(queued).toBe(2);

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    const result = await runSyncWorker();

    expect(result).toMatchObject({ done: 2, failed: 0 });

    // One append per sheet, each carrying the same entry.
    const appends = calls.filter((c) => c.method === "append");
    expect(appends).toHaveLength(2);
    expect(
      new Set(
        appends.map(
          (a) => (a.args as { spreadsheetId: string }).spreadsheetId,
        ),
      ),
    ).toEqual(new Set(["project-sheet", "developer-sheet"]));

    // And a position remembered in each, so a later correction finds both.
    const links = await owner`
      SELECT connection_id FROM sheet_row_links WHERE work_log_id = ${log.id}`;
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => (l as { connection_id: string }).connection_id)))
      .toEqual(new Set([projectSheet, devSheet]));
  });

  it("gives the two sheets distinct idempotency keys", async () => {
    // The bug this guards: keyed on the revision alone, the second sheet's job
    // collides with the first and is silently dropped by onConflictDoNothing —
    // one sheet updates forever and the other quietly never does.
    const userId = await makeUser({ name: "Ahmed" });
    const projectId = await makeProject({ code: "TS-001" });
    await makeConnection({ projectId, spreadsheetId: "p", headerHash: validHash });
    await makeConnection({ userId, spreadsheetId: "d", headerHash: validHash });

    const log = await makeWorkLog({ projectId, userId });
    await db.transaction((tx) =>
      enqueueSheetWrite(tx, {
        projectId,
        userId,
        workLogId: log.id,
        jobType: "append",
        changeKey: `revision:${log.revisionId}`,
      }),
    );

    const keys = await owner`
      SELECT idempotency_key FROM sync_jobs WHERE work_log_id = ${log.id}`;
    expect(keys).toHaveLength(2);
    expect(
      new Set(keys.map((k) => (k as { idempotency_key: string }).idempotency_key)),
    ).toHaveProperty("size", 2);
  });

  it("still queues nothing when neither has a sheet", async () => {
    const userId = await makeUser({ name: "Ahmed" });
    const projectId = await makeProject({ code: "TS-001" });
    const log = await makeWorkLog({ projectId, userId });

    const queued = await db.transaction((tx) =>
      enqueueSheetWrite(tx, {
        projectId,
        userId,
        workLogId: log.id,
        jobType: "append",
        changeKey: `revision:${log.revisionId}`,
      }),
    );
    expect(queued).toBe(0);
  });

  it("collects one person's work across every project into their sheet", async () => {
    const userId = await makeUser({ name: "Ahmed" });
    const projectA = await makeProject({ code: "AAA-1" });
    const projectB = await makeProject({ code: "BBB-2" });
    await makeConnection({ userId, spreadsheetId: "d", headerHash: validHash });

    for (const projectId of [projectA, projectB]) {
      const log = await makeWorkLog({ projectId, userId });
      await db.transaction((tx) =>
        enqueueSheetWrite(tx, {
          projectId,
          userId,
          workLogId: log.id,
          jobType: "append",
          changeKey: `revision:${log.revisionId}`,
        }),
      );
    }

    const { client, calls } = fakeSheets({});
    __setSheetsClientForTests(client);
    await runSyncWorker();

    // Both rows go to the one sheet, in one call, and each names its project.
    const appends = calls.filter((c) => c.method === "append");
    expect(appends).toHaveLength(1);
    const rows = (
      appends[0].args as { requestBody: { values: string[][] } }
    ).requestBody.values;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r[2]))).toEqual(
      new Set(["Test Project", "Test Project"]),
    );
  });
});
