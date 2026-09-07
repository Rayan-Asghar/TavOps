"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireActingActor } from "@/lib/authz";
import { UserFacingError } from "@/lib/errors";
import { changeNameSchema, changePasswordSchema } from "./settings-schemas";
import { writeAudit } from "./audit";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";

/**
 * Changing your own name and password.
 *
 * There was no self-service anything: a forgotten password meant asking an
 * admin to reset it, which puts a colleague's temporary password into a chat
 * message and leaves it there.
 */

export async function changeNameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActingActor();
    const { name } = changeNameSchema.parse({
      name: String(formData.get("name") ?? ""),
    });

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ name, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "user",
        entityId: actor.id,
        action: "user.rename",
        before: { name: actor.name },
        after: { name },
      });
    });

    revalidatePath("/settings");
    return { ok: true, message: "Name updated." };
  } catch (err) {
    return { error: safeErrorMessage(err, "changeName") };
  }
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActingActor();
    const data = changePasswordSchema.parse({
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    if (!row) throw new UserFacingError("That account no longer exists.");

    /* Somebody who has only ever signed in with Google has no password to
       confirm, so this form is not the way in for them — they set one from the
       invite link, or an admin resets it. Checked before the compare rather
       than after: there is no hash to compare against, and inventing one would
       report "wrong password" for an account that has none. */
    if (!row.passwordHash) {
      throw new UserFacingError(
        "This account signs in with Google and has no password to change.",
      );
    }

    // The current password is required so that a borrowed unlocked laptop
    // cannot be turned into a permanent account takeover in two clicks.
    const ok = await bcrypt.compare(data.currentPassword, row.passwordHash);
    if (!ok) throw new UserFacingError("That is not your current password.");

    const passwordHash = await bcrypt.hash(data.newPassword, 12);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          // Every other session of theirs dies on its next request. Somebody
          // changing their password usually believes the old one is known to
          // someone else, and leaving those sessions alive defeats the change.
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, actor.id));

      // No before/after: the only thing that changed is a hash, and recording
      // anything about it is worse than recording that it happened.
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "user",
        entityId: actor.id,
        action: "user.change_password",
      });
    });

    return {
      ok: true,
      message:
        "Password changed. Any other device you were signed in on has been signed out.",
    };
  } catch (err) {
    return { error: safeErrorMessage(err, "changePassword") };
  }
}
