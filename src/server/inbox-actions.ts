"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { safeErrorMessage } from "./action-errors";
import { resolveNotification, restoreNotification } from "./notifications";

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
    await resolveNotification(id, actor.id);
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
