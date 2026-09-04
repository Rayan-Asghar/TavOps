/**
 * Whether an account may sign in at all, independent of how it proved identity.
 *
 * Password and Google are two ways of answering "who are you". Neither answers
 * "may you be here" — that is this rule, and both providers run it, so a
 * condition added for one cannot be silently missing from the other. A way in
 * that nobody tested is exactly how an internal tool stops being internal.
 *
 * Pure and in its own file because `auth.ts` imports the database driver, which
 * a unit test cannot load; and because this is the check most worth having
 * tests for.
 */

export type SignInCandidate = {
  isActive: boolean;
  /** Temp collaborators revoke themselves on this date. */
  accessExpiresAt: Date | null;
};

export function maySignIn(
  account: SignInCandidate | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!account) return false;
  if (!account.isActive) return false;
  // Same comparison as `isActorExpired` in access.ts, deliberately: expiry has
  // to mean the same thing at the door as it does inside the building.
  if (account.accessExpiresAt && account.accessExpiresAt <= now) return false;
  return true;
}
