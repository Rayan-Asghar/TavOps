"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import { isSaveablePath, normaliseViewQuery } from "@/lib/saved-view";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";

/**
 * Saving and removing a view.
 *
 * No capability check: a saved view is a bookmark, and it can only point at a
 * screen the person can already open. What it CANNOT do is point somewhere
 * else — `isSaveablePath` is an allow-list, because a user-supplied URL stored
 * and later navigated to is how a bookmark feature becomes an open redirect.
 */
export async function saveViewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();

    const name = String(formData.get("name") ?? "").trim();
    const path = String(formData.get("path") ?? "");
    const query = normaliseViewQuery(String(formData.get("query") ?? ""));
    const isShared = formData.get("isShared") === "on";

    if (name.length < 2) throw new UserFacingError("Give the view a name.");
    if (name.length > 80) throw new UserFacingError("That name is too long.");
    if (!isSaveablePath(path)) {
      throw new UserFacingError("That screen cannot hold a saved view.");
    }

    await db
      .insert(savedViews)
      .values({ userId: actor.id, name, path, query, isShared })
      // Saving twice under one name corrects the view rather than leaving two
      // entries that look identical in the list.
      .onConflictDoUpdate({
        target: [savedViews.userId, savedViews.path, savedViews.name],
        set: { query, isShared },
      });

    revalidatePath(path);
    return { ok: true, message: `Saved “${name}”.` };
  } catch (err) {
    return { error: safeErrorMessage(err, "saveView") };
  }
}

export async function deleteViewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");

    // Scoped to the owner in the WHERE clause, not checked separately: only
    // your own view can be deleted, including a shared one you created.
    const [gone] = await db
      .delete(savedViews)
      .where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id)))
      .returning({ path: savedViews.path });

    if (!gone) throw new UserFacingError("That view no longer exists.");
    revalidatePath(gone.path);
    return { ok: true, message: "View removed." };
  } catch (err) {
    return { error: safeErrorMessage(err, "deleteView") };
  }
}
