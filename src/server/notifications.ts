import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { notifications, type notificationKind } from "@/db/schema";

type Kind = (typeof notificationKind.enumValues)[number];

export type NotifyInput = {
  userId: string;
  kind: Kind;
  title: string;
  body?: string;
  projectId?: string | null;
  taskId?: string | null;
  blockerId?: string | null;
  /** Actionable items stay in the inbox until dealt with, not merely opened. */
  isActionable?: boolean;
  /**
   * Collapses repeat sweeps into a single row. The nightly stale-task job runs
   * every day but must not produce a new "you owe an update" line every day for
   * the same task — that is how an inbox becomes noise people stop reading.
   */
  dedupeKey?: string | null;
};

export async function notify(input: NotifyInput, tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0] = db) {
  await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      blockerId: input.blockerId ?? null,
      isActionable: input.isActionable ?? false,
      dedupeKey: input.dedupeKey ?? null,
    })
    /**
     * Half of snooze-with-wake (DESIGN-STANDARD 2.1).
     *
     * This used to be `onConflictDoNothing`, which is right for the nagging it
     * was written to prevent: the nightly stale-task sweep must not add a line
     * a day for the same task. But it is wrong for a *snoozed* row, because
     * "do nothing" would keep the item hidden while the condition kept
     * recurring — snoozing "sheet sync failed" for a day would swallow every
     * failure that day, which is precisely how a defer becomes a data loss.
     *
     * So a recurrence still writes nothing new, but it clears the snooze. The
     * WHERE guard means an un-snoozed row is genuinely untouched, so this stays
     * a no-op in the common case rather than churning `updated` timestamps.
     */
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.dedupeKey],
      set: { snoozedUntil: null, snoozedAt: null },
      setWhere: sql`${notifications.snoozedUntil} is not null`,
    });
}

/** Hidden right now: snoozed into the future and not yet resolved. */
const notSnoozed = or(
  isNull(notifications.snoozedUntil),
  sql`${notifications.snoozedUntil} <= now()`,
);

/** Inbox = unresolved actionable items first, then recent informational ones. */
export async function inboxFor(userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.resolvedAt),
        notSnoozed,
      ),
    )
    .orderBy(desc(notifications.isActionable), desc(notifications.createdAt))
    .limit(limit);
}

export async function unresolvedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      /**
       * 2.5: the counter shows total outstanding, never "unread", so the number
       * only falls when you act. Snoozing IS acting — a deferred item is not
       * something you still owe today — so it leaves the count, and returns to
       * it when the snooze lapses.
       */
      and(
        eq(notifications.userId, userId),
        isNull(notifications.resolvedAt),
        notSnoozed,
      ),
    );
  return row?.n ?? 0;
}

export async function resolveNotification(
  id: string,
  userId: string,
  /** Optional. r21 forbids a confirm step on a routine action, and demanding a
   *  reason on every dismissal would be one. */
  note?: string | null,
) {
  await db
    .update(notifications)
    .set({
      resolvedAt: new Date(),
      seenAt: new Date(),
      dismissNote: note?.trim() || null,
      // Dismissing a snoozed item ends the snooze; otherwise the row would come
      // back out of hiding already resolved, which is just confusing state.
      snoozedUntil: null,
      snoozedAt: null,
    })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

/**
 * The fourth exit: gone until a moment you choose, or until the thing happens
 * again — whichever comes first. See `notify()` for the second half.
 *
 * r21 makes this reversible with no confirm step, so there is no dialog here;
 * the caller offers undo instead.
 */
export async function snoozeNotification(
  id: string,
  userId: string,
  until: Date,
) {
  await db
    .update(notifications)
    .set({ snoozedUntil: until, snoozedAt: new Date(), seenAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        // Never snooze something already dealt with.
        isNull(notifications.resolvedAt),
      ),
    );
}

/** Undo for a snooze. Puts it straight back in the queue. */
export async function unsnoozeNotification(id: string, userId: string) {
  await db
    .update(notifications)
    .set({ snoozedUntil: null, snoozedAt: null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

/**
 * What is currently deferred, for the "N snoozed" line under the queue.
 *
 * 2.6 is explicit that snoozed and dismissed items must stay queryable, "or
 * people stop dismissing" — a queue you cannot look behind is one nobody trusts
 * enough to empty.
 */
export async function snoozedFor(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.resolvedAt),
        gt(notifications.snoozedUntil, sql`now()`),
      ),
    )
    .orderBy(notifications.snoozedUntil)
    .limit(limit);
}

/** Used when the underlying thing is fixed, so the inbox line disappears. */
export async function resolveByDedupeKey(
  userId: string,
  dedupeKey: string,
  tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0] = db,
) {
  await tx
    .update(notifications)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.dedupeKey, dedupeKey),
        isNull(notifications.resolvedAt),
      ),
    );
}

/**
 * Clears the resolved mark, putting an item back in the inbox.
 *
 * `seenAt` is deliberately left alone: it was seen, and undoing a dismissal
 * does not make that untrue.
 */
export async function restoreNotification(id: string, userId: string) {
  await db
    .update(notifications)
    .set({ resolvedAt: null, dismissNote: null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}
