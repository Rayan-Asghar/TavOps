"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
import {
  hashInviteToken,
  inviteExpiryFrom,
  mintInviteToken,
} from "@/lib/invite-token";
import { assertCan } from "@/lib/rbac";
import { createUserSchema } from "./user-schemas";
import { writeAudit } from "./audit";

import type { ActionState } from "@/lib/action-state";
import { UserFacingError } from "@/lib/errors";
import { safeErrorMessage } from "./action-errors";
export type UserFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown exactly once, immediately after creation. Never recoverable. */
  tempPassword?: string;
  /** The invite link, shown once for the same reason. A path, not an absolute
   *  URL: the server does not reliably know its own public origin behind a
   *  proxy, and the client that renders it does. */
  invitePath?: string;
  createdName?: string;
};

function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function createUserAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireActor();
  assertCan(actor.globalRole, "user.manage");

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    globalRole: formData.get("globalRole"),
    weeklyCapacityHours: formData.get("weeklyCapacityHours") || 40,
    accessExpiresAt: formData.get("accessExpiresAt") ?? "",
  });

  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  const data = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);

  if (existing) {
    return {
      error: "That email already has an account.",
      fieldErrors: { email: "Already in use." },
    };
  }

  /* No password is minted here any more. The account is created WITHOUT one and
     the admin sends a link instead — that handover is what produced nine
     accounts sharing a single password, and it is the thing being retired.

     Where Google is configured the invitee does not even need the link:
     `maySignIn` passes the moment this row exists, because the admin choosing
     the address is the authorisation. The link's job is setting a password for
     everyone else. */
  const inviteToken = mintInviteToken();

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        passwordHash: null,
        inviteTokenHash: hashInviteToken(inviteToken),
        inviteExpiresAt: inviteExpiryFrom(),
        invitedById: actor.id,
        globalRole: data.globalRole,
        weeklyCapacityHours: data.weeklyCapacityHours,
        accessExpiresAt: data.accessExpiresAt,
      })
      .returning();

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: row.id,
      action: "user.create",
      after: { email: row.email, globalRole: row.globalRole },
    });

    return row;
  });

  revalidatePath("/admin/users");

  // Returned once so the admin can hand it over. Only the hash was stored, so
  // there is no second chance to read it — re-issuing mints a new one.
  return {
    ok: true,
    invitePath: `/invite/${inviteToken}`,
    createdName: created.name,
  };
}

export async function setUserActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
 try {
  const actor = await requireActor();
  assertCan(actor.globalRole, "user.manage");

  const userId = String(formData.get("userId") ?? "");
  const makeActive = formData.get("makeActive") === "true";
  if (!userId) throw new UserFacingError("No account given.");

  // An admin deactivating themselves can lock the whole team out of user
  // management. The refusal is now said out loud rather than being a `return;`.
  if (userId === actor.id && !makeActive) {
    throw new UserFacingError("You cannot deactivate your own account.");
  }

  if (!makeActive) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.globalRole, "admin"),
          eq(users.isActive, true),
          ne(users.id, userId),
        ),
      );
    const [target] = await db
      .select({ globalRole: users.globalRole })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // Never let the last active admin be switched off.
    if (target?.globalRole === "admin" && n === 0) {
      throw new UserFacingError(
        "This is the last active admin. Promote someone else first.",
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      // Bumped on deactivation so their session dies on the next request
      // rather than whenever the twelve-hour token happens to expire. Bumped on
      // reactivation too: the version is a revocation counter, not a state flag,
      // and skipping it would let a token minted before the deactivation work
      // again afterwards.
      .set({
        isActive: makeActive,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: userId,
      action: makeActive ? "user.activate" : "user.deactivate",
      before: { isActive: !makeActive },
      after: { isActive: makeActive },
    });
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: makeActive ? "Account reactivated." : "Account deactivated.",
  };
 } catch (err) {
  return { error: safeErrorMessage(err, "setUserActive") };
 }
}

export async function resetPasswordAction(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireActor();
  assertCan(actor.globalRole, "user.manage");

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "No user selected." };

  const tempPassword = generatePassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      // A reset exists because somebody lost control of the old password.
      // Leaving their existing sessions alive would defeat the reset.
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ name: users.name });
    // No before/after: the only thing that changed is a hash, and recording
    // anything about it is worse than recording that it happened.
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: userId,
      action: "user.reset_password",
    });
    return rows;
  });

  if (!updated) return { error: "That user no longer exists." };

  revalidatePath("/admin/users");
  return { ok: true, tempPassword, createdName: updated.name };
}
