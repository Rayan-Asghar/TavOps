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
 * Queues the sheet write for one entry, in the same transaction as the change.
 *
 * A sheet belongs to one person on one project, so an entry has exactly one
 * destination: the sheet for whose work it is and what it was on. Two
 * developers on a project keep two sheets and never appear in each other's.
 *
 * The outbox pattern, and the reason a sheet cannot drift from the database: an
 * entry cannot be recorded without its write being queued, and a write cannot be
 * queued for work that was not recorded. Nothing here contacts Google, so a slow
 * or unreachable API never sits between a developer and their submit.
 */
export async function enqueueSheetWrite(
  tx: Tx,
  input: {
    projectId: string;
    userId: string;
    workLogId: string;
    jobType: SyncJobType;
    /**
     * Deterministic, so a retry after a timeout collides with the unique index
     * and becomes a no-op rather than a second row in the sheet.
     */
    changeKey: string;
  },
): Promise<boolean> {
  const [connection] = await tx
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(
      and(
        eq(sheetConnections.status, "active"),
        eq(sheetConnections.projectId, input.projectId),
        eq(sheetConnections.userId, input.userId),
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
      idempotencyKey: `${input.changeKey}:${connection.id}`,
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
