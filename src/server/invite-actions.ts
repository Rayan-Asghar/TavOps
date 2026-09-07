"use server";

import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { UserFacingError } from "@/lib/errors";
import {
  hashInviteToken,
  inviteExpiryFrom,
  mintInviteToken,
} from "@/lib/invite-token";
import { rowForInviteToken } from "./invite-queries";
import { writeAudit } from "./audit";
import { safeErrorMessage } from "./action-errors";
import type { ActionState } from "@/lib/action-state";
import { revalidatePath } from "next/cache";

/**
 * Accepting and re-issuing invitations.
 *
 * Every export of a `"use server"` module is a callable endpoint, which is why
 * the reads live in `invite-queries.ts` instead — as actions they would be a way
 * to probe the users table from outside.
 *
 * What is left is two writes with deliberately different gates: accepting is
 * unauthenticated by necessity — the whole point is that the caller cannot sign
 * in yet — so it is gated on the token alone. Re-issuing is an admin action and
 * checks `user.manage` like every other one.
 */

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(200, "That is longer than necessary."),
  confirm: z.string(),
});

/**
 * Sets the password an invite was sent for.
 *
 * The token is looked up again inside the transaction rather than trusted from
 * the page that rendered the form: between the page load and the submit it may
 * have been re-issued, accepted or expired, and only the write is authoritative.
 */
export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const parsed = acceptSchema.safeParse({
      token: String(formData.get("token") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirm: String(formData.get("confirm") ?? ""),
    });
    if (!parsed.success) {
      return {
        error:
          parsed.error.issues[0]?.message ?? "Check the highlighted fields.",
      };
    }
    const { token, password, confirm } = parsed.data;
    if (password !== confirm) {
      return { error: "Those two passwords do not match." };
    }

    const row = await rowForInviteToken(token);
    // One message for unknown, expired and already-used. Distinguishing them
    // tells a stranger which tokens once existed.
    if (!row) {
      throw new UserFacingError(
        "That invite link is no longer valid. Ask whoever sent it to issue a new one.",
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({
          passwordHash,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          /* Anything already issued in this person's name stops working. An
             invite link that reached the wrong inbox may have been used before
             the real person got here. */
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        // Re-checked in the write itself, so two submits of the same link cannot
        // both succeed: the second matches no row.
        .where(
          and(
            eq(users.id, row.id),
            eq(users.inviteTokenHash, hashInviteToken(token)),
          ),
        )
        .returning({ id: users.id });

      if (updated.length === 0) {
        throw new UserFacingError(
          "That invite link is no longer valid. Ask whoever sent it to issue a new one.",
        );
      }

      await writeAudit(tx, {
        // The invitee is acting on their own account, before they have a
        // session — so they are the actor, not the admin who invited them.
        actorId: row.id,
        entityType: "user",
        entityId: row.id,
        action: "user.invite.accept",
        after: { email: row.email },
      });
    });

    return { ok: true, message: "Password set. You can sign in now." };
  } catch (err) {
    return { error: safeErrorMessage(err, "acceptInvite") };
  }
}

/**
 * Mints a replacement invite, invalidating the previous one.
 *
 * Also the way to re-invite somebody whose link expired, which is why it does
 * not require that one currently exists — only that the account has never had a
 * password set. Somebody with a password is not waiting on an invite; they want
 * `resetPasswordAction`, which is a different thing for a different situation.
 */
export async function reissueInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "user.manage");

    const id = String(formData.get("id") ?? "");
    if (!id) throw new UserFacingError("Nothing to re-invite.");

    const [target] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!target) throw new UserFacingError("That account no longer exists.");
    if (!target.isActive) {
      throw new UserFacingError(
        "That account is deactivated. Reactivate it before inviting again.",
      );
    }
    if (target.passwordHash) {
      throw new UserFacingError(
        "That account already has a password. Use Reset password instead.",
      );
    }

    const token = mintInviteToken();
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          inviteTokenHash: hashInviteToken(token),
          inviteExpiresAt: inviteExpiryFrom(),
          invitedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(users.id, target.id));

      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "user",
        entityId: target.id,
        action: "user.invite.reissue",
        after: { email: target.email },
      });
    });

    revalidatePath("/admin/users");
    return { ok: true, message: `/invite/${token}` };
  } catch (err) {
    return { error: safeErrorMessage(err, "reissueInvite") };
  }
}

