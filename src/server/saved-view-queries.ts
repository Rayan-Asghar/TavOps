import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { isSaveablePath } from "@/lib/saved-view";

/**
 * Reading saved views.
 *
 * NOT in the `"use server"` action module, and that is not tidiness: every
 * export of one becomes a callable endpoint. `viewsFor` takes a `userId`, so
 * as an action it would let any caller pass somebody else's id and read their
 * views. Queries take their actor from the page that already authenticated it.
 */

export type SavedViewRow = {
  id: string;
  name: string;
  query: string;
  isShared: boolean;
  isMine: boolean;
};

/** Views for one screen: this person's, plus anything shared with the team. */
export async function viewsFor(
  path: string,
  userId: string,
): Promise<SavedViewRow[]> {
  if (!isSaveablePath(path)) return [];

  const rows = await db
    .select({
      id: savedViews.id,
      name: savedViews.name,
      query: savedViews.query,
      isShared: savedViews.isShared,
      userId: savedViews.userId,
    })
    .from(savedViews)
    .where(
      and(
        eq(savedViews.path, path),
        or(eq(savedViews.userId, userId), eq(savedViews.isShared, true)),
      ),
    )
    .orderBy(asc(savedViews.orderIndex), asc(savedViews.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    query: r.query,
    isShared: r.isShared,
    isMine: r.userId === userId,
  }));
}
