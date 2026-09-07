/**
 * Whether a signed-in session is still allowed to act.
 *
 * A JWT session is a claim made at sign-in and believed for twelve hours. That
 * is fine for identity and wrong for authority: deactivating somebody, or
 * letting a contractor's access lapse, has to take effect NOW rather than
 * whenever their token happens to expire.
 *
 * The three conditions are checked together, on the row, at the one point every
 * server component and server action already passes through (`getActor`).
 * Putting them in the `session` callback was not an option: `auth.config.ts` is
 * imported by `src/proxy.ts` on the edge runtime, where the Postgres driver
 * cannot load — its own header says so.
 *
 * Pure, so the boundary cases are testable without a request or a database.
 */

export type SessionClaims = {
  /** `users.session_version` as it was when the token was issued. */
  sessionVersion: number;
};

export type AccountState = {
  isActive: boolean;
  accessExpiresAt: Date | null;
  sessionVersion: number;
};

export type SessionVerdict =
  | { valid: true }
  | { valid: false; reason: "deactivated" | "expired" | "revoked" };

export function isSessionStillValid(
  claims: SessionClaims,
  account: AccountState | null,
  now: Date = new Date(),
): SessionVerdict {
  // A token naming a user who no longer exists is not a valid session; the row
  // is gone, so there is nothing to authorise against.
  if (!account) return { valid: false, reason: "deactivated" };
  if (!account.isActive) return { valid: false, reason: "deactivated" };

  // Same comparison as `isActorExpired`: the boundary belongs to the side that
  // denies, so access never outlives its stated end by a tick.
  if (account.accessExpiresAt && account.accessExpiresAt <= now) {
    return { valid: false, reason: "expired" };
  }

  // Bumped by a password change and by an explicit revoke. A token issued
  // before the bump is stale by exactly the amount that matters.
  if (claims.sessionVersion !== account.sessionVersion) {
    return { valid: false, reason: "revoked" };
  }

  return { valid: true };
}
