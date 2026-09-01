import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import type { Db } from "@/db";
import { sheetConnections, syncJobs } from "@/db/schema";
import { log } from "@/lib/logger";
import { runSyncWorker } from "./sync-worker";

/**
 * The seam between recording work and mirroring it into a sheet.
 *
 * Not a `"use server"` module: every export of one becomes a callable endpoint,
 * and these are helpers. Kept separate from the worker so the write path depends
 * on enqueuing, never on Google being reachable.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type SyncJobType = "append" | "update" | "delete";

/**
 * Queues a sheet write in the same transaction as the change that caused it.
 *
 * The outbox pattern, and the reason the sheet cannot drift from the database:
 * an entry cannot be recorded without its write being queued, and a write cannot
 * be queued for work that was not recorded. Nothing here contacts Google, so a
 * slow or unreachable API never sits between a developer and their submit.
 *
 * Does nothing when the project has no active sheet, which is the normal case
 * for a project that opted out.
 */
export async function enqueueSheetWrite(
  tx: Tx,
  input: {
    projectId: string;
    workLogId: string;
    jobType: SyncJobType;
    /**
     * Deterministic, so a retry after a timeout collides with the unique index
     * and becomes a no-op rather than a second row in the sheet.
     */
    idempotencyKey: string;
  },
): Promise<boolean> {
  const [connection] = await tx
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(
      and(
        eq(sheetConnections.projectId, input.projectId),
        eq(sheetConnections.status, "active"),
      ),
    )
    .limit(1);

  if (!connection) return false;

  await tx
    .insert(syncJobs)
    .values({
      connectionId: connection.id,
      workLogId: input.workLogId,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: syncJobs.idempotencyKey });

  return true;
}

/**
 * Drains the queue once the response has gone out.
 *
 * The scheduler that would normally do this does not exist yet, and making a
 * developer wait on the Sheets API to see their own work logged would be the
 * wrong trade. `after()` runs once the response is sent, so the write happens
 * promptly without being in the request's path.
 *
 * A bridge, not a replacement. If the process dies before the drain runs, the
 * job simply stays queued and the next write — or cron, once there is a host —
 * picks it up. That is what the queue is for.
 */
export function scheduleDrain(): void {
  after(async () => {
    try {
      await runSyncWorker();
    } catch (err) {
      // Never surface: the response is already sent, and the job is still
      // queued for the next attempt.
      log.error("sync.drain.failed", { err });
    }
  });
}
