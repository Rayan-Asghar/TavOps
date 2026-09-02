import { and, eq, or } from "drizzle-orm";
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
 * Queues the sheet writes for one entry, in the same transaction as the change.
 *
 * An entry belongs to two sheets at once: the project's, and the developer's.
 * Both are written, and neither is derived from the other — a developer sheet
 * is not a filtered view of a project sheet, it is a different spreadsheet
 * somebody was given.
 *
 * The outbox pattern, and the reason a sheet cannot drift from the database: an
 * entry cannot be recorded without its writes being queued, and a write cannot
 * be queued for work that was not recorded. Nothing here contacts Google, so a
 * slow or unreachable API never sits between a developer and their submit.
 *
 * Returns how many sheets the entry is bound for, which is zero for a project
 * and developer that both opted out.
 */
export async function enqueueSheetWrite(
  tx: Tx,
  input: {
    projectId: string;
    /** Whose work it is; decides the developer sheet. */
    userId: string;
    workLogId: string;
    jobType: SyncJobType;
    /**
     * Identifies the CHANGE, not the job. The connection id is appended per
     * job below: two sheets receiving the same revision must not collide on one
     * key, or the second sheet silently never gets its row.
     */
    changeKey: string;
  },
): Promise<number> {
  const connections = await tx
    .select({ id: sheetConnections.id })
    .from(sheetConnections)
    .where(
      and(
        eq(sheetConnections.status, "active"),
        or(
          eq(sheetConnections.projectId, input.projectId),
          eq(sheetConnections.userId, input.userId),
        ),
      ),
    );

  if (connections.length === 0) return 0;

  await tx
    .insert(syncJobs)
    .values(
      connections.map((c) => ({
        connectionId: c.id,
        workLogId: input.workLogId,
        jobType: input.jobType,
        idempotencyKey: `${input.changeKey}:${c.id}`,
      })),
    )
    .onConflictDoNothing({ target: syncJobs.idempotencyKey });

  return connections.length;
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
