import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invite tokens.
 *
 * Deliberately shares nothing with `password.ts`. That alphabet exists because
 * a temp password gets transcribed by hand into a chat message, so it drops
 * 0/O/1/l/I to avoid a support request. A URL token is never transcribed — it is
 * copied whole — so it should maximise entropy per character instead, and
 * base64url is the right shape for something that has to survive being a path
 * segment.
 *
 * Stored hashed for the same reason a password is: the database is not the only
 * place a row is ever read from, and a token that can be read back later is a
 * credential that leaks later. The plaintext exists exactly once, in the
 * response that mints it.
 *
 * Pure and separate from the actions so the boundary cases are testable — a
 * `"use server"` module may only export async functions, so a predicate cannot
 * live there and still be reachable from a test.
 */

/** Seven days. Long enough to survive a weekend and a missed message, short
 *  enough that a link forwarded into a group chat stops working. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 bytes of CSPRNG, base64url — 256 bits, and URL-safe without escaping. */
export function mintInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, not bcrypt.
 *
 * bcrypt is deliberately slow to make guessing a *low-entropy human-chosen*
 * secret expensive. This token is 256 random bits: there is nothing to guess,
 * so the work factor buys no security and costs a slow hash on every invite
 * page load. Hashing at all is about what a database read reveals, not about
 * resisting a brute force.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak, so the
 * lengths are checked first and a mismatch answers false without measuring.
 */
export function inviteTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashInviteToken(token), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Expired, or never issued. `expiresAt` is exclusive: exactly-now is expired. */
export function isInviteExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

/** The moment a token minted now stops working. */
export function inviteExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}
