"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { safeErrorMessage } from "./action-errors";
import {
  resolveNotification,
  restoreNotification,
  snoozeNotification,
  unsnoozeNotification,
} from "./notifications";

export async function dismissNotification(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    if (!id) throw new UserFacingError("Nothing to dismiss.");
    // Scoped to the actor's own rows, so a guessed id cannot clear someone
    // else's inbox.
    // Optional: r21 forbids a confirm step on a routine action, so nothing is
    // demanded here. When a note is given it is worth keeping — it is the only
    // record of *why* something was waved off.
    await resolveNotification(id, actor.id, String(formData.get("note") ?? ""));
    revalidatePath("/");
    // Dismissing used to be irreversible from the UI. The row is only marked
    // resolved, so putting it back is a matter of clearing that mark.
    return { ok: true, message: "Dismissed.", undoToken: id };
  } catch (err) {
    return { error: safeErrorMessage(err, "dismissNotification") };
  }
}

/** Puts a dismissed item back in the inbox. Paired with the undo toast. */
export async function undismissNotification(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    if (!id) throw new UserFacingError("Nothing to restore.");
    await restoreNotification(id, actor.id);
    revalidatePath("/");
    return { ok: true, message: "Restored." };
  } catch (err) {
    return { error: safeErrorMessage(err, "undismissNotification") };
  }
}

/**
 * The fourth exit from the queue (2.1).
 *
 * `until` is a preset offset rather than a free date, because the choice is
 * "later today / tomorrow / next week", not a calendar problem. r21 makes it
 * reversible with no confirm step, hence the undo token.
 */
const SNOOZE_OFFSETS: Record<string, number> = {
  "3h": 3 * 60 * 60 * 1000,
  tomorrow: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

export async function snoozeNotificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    const key = String(formData.get("until") ?? "tomorrow");
    if (!id) throw new UserFacingError("Nothing to snooze.");
    const offset = SNOOZE_OFFSETS[key];
    if (!offset) throw new UserFacingError("Pick when it should come back.");

    await snoozeNotification(id, actor.id, new Date(Date.now() + offset));
    revalidatePath("/");
    const label =
      key === "3h" ? "in 3 hours" : key === "week" ? "next week" : "tomorrow";
    return { ok: true, message: `Snoozed until ${label}.`, undoToken: id };
  } catch (err) {
    return { error: safeErrorMessage(err, "snoozeNotification") };
  }
}

/** Undo for a snooze, and the way back out of the snoozed list. */
export async function unsnoozeNotificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const id = String(formData.get("id") ?? "");
    if (!id) throw new UserFacingError("Nothing to restore.");
    await unsnoozeNotification(id, actor.id);
    revalidatePath("/");
    return { ok: true, message: "Back in the queue." };
  } catch (err) {
    return { error: safeErrorMessage(err, "unsnoozeNotification") };
  }
}
