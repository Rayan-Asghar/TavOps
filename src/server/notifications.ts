import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
    .onConflictDoNothing({
      target: [notifications.userId, notifications.dedupeKey],
    });
}

/** Inbox = unresolved actionable items first, then recent informational ones. */
export async function inboxFor(userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.resolvedAt),
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
      and(eq(notifications.userId, userId), isNull(notifications.resolvedAt)),
    );
  return row?.n ?? 0;
}

export async function resolveNotification(id: string, userId: string) {
  await db
    .update(notifications)
    .set({ resolvedAt: new Date(), seenAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
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
