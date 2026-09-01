import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * The one way operational changes get written to the audit trail.
 *
 * Not a `"use server"` module — every export of one becomes a callable
 * endpoint, and this is a helper, not an action.
 *
 * It takes a transaction rather than opening its own, because an audit row that
 * can commit while the change it describes rolls back is worse than no audit
 * row: it asserts something happened that did not. Callers pass the same `tx`
 * they made the change in.
 *
 * Writes `before`/`after` rather than the older `detail` column. `detail` is
 * deprecated and still used by the pre-existing user/team/timer/handoff call
 * sites; those migrate separately, and the column is dropped once they have.
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type AuditEntry = {
  actorId?: string | null;
  projectId?: string | null;
  /** The table in question, e.g. "work_log". Free text by design. */
  entityType: string;
  entityId?: string | null;
  /** Dotted verb, e.g. "work_log.edit". */
  action: string;
  /** The fields that changed, not the whole row — a diff stays readable. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorType: "user",
    actorId: entry.actorId ?? null,
    projectId: entry.projectId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    source: "ui",
  });
}
