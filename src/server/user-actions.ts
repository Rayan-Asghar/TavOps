"use server";

import { randomInt } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { createUserSchema } from "./user-schemas";

export type UserFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown exactly once, immediately after creation. Never recoverable. */
  tempPassword?: string;
  createdName?: string;
};

// No 0/O/1/l/I: these get transcribed by hand into a chat message, and an
// ambiguous character turns into a support request.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

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

  const tempPassword = generatePassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        passwordHash,
        globalRole: data.globalRole,
        weeklyCapacityHours: data.weeklyCapacityHours,
        accessExpiresAt: data.accessExpiresAt,
      })
      .returning();

    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: "user.create",
      entityType: "user",
      entityId: row.id,
      detail: { email: row.email, globalRole: row.globalRole },
    });

    return row;
  });

  revalidatePath("/admin/users");

  // Returned once so the admin can hand it over. It is not stored anywhere in
  // recoverable form, so there is no second chance to read it.
  return { ok: true, tempPassword, createdName: created.name };
}

export async function setUserActiveAction(formData: FormData) {
  const actor = await requireActor();
  assertCan(actor.globalRole, "user.manage");

  const userId = String(formData.get("userId") ?? "");
  const makeActive = formData.get("makeActive") === "true";
  if (!userId) return;

  // An admin deactivating themselves can lock the whole team out of user
  // management, so the action refuses rather than relying on care.
  if (userId === actor.id && !makeActive) return;

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
    if (target?.globalRole === "admin" && n === 0) return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: makeActive, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: makeActive ? "user.activate" : "user.deactivate",
      entityType: "user",
      entityId: userId,
    });
  });

  revalidatePath("/admin/users");
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
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ name: users.name });
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: "user.reset_password",
      entityType: "user",
      entityId: userId,
    });
    return rows;
  });

  if (!updated) return { error: "That user no longer exists." };

  revalidatePath("/admin/users");
  return { ok: true, tempPassword, createdName: updated.name };
}
