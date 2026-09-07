import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashInviteToken, isInviteExpired } from "@/lib/invite-token";

/**
 * Reads about invitations.
 *
 * Deliberately NOT a `"use server"` module. Every export of one of those becomes
 * a callable endpoint, and both functions here take an argument that decides
 * which row comes back — as actions they would be a way to probe the users table
 * from outside. Server components import them directly instead, so they are
 * reachable only from code that already ran the caller's authorisation.
 */

/** The row an invite token points at, or null — never says which check failed. */
export async function rowForInviteToken(token: string) {
  if (!token) return null;

  const [found] = await db
    .select()
    .from(users)
    .where(eq(users.inviteTokenHash, hashInviteToken(token)))
    .limit(1);

  if (!found) return null;
  if (isInviteExpired(found.inviteExpiresAt)) return null;
  // An invite cannot rescue an account somebody has since switched off.
  if (!found.isActive) return null;
  return found;
}

/**
 * What the public invite page is allowed to know.
 *
 * A boolean and a display name, never the row. The name is worth showing so the
 * invitee can tell the link was meant for them; anything more would make a page
 * that needs no session into a way to read user records.
 */
export async function inspectInvite(
  token: string,
): Promise<{ valid: boolean; name?: string }> {
  const row = await rowForInviteToken(token);
  return row ? { valid: true, name: row.name } : { valid: false };
}
