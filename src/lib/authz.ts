import { cache } from "react";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor, UnauthenticatedError } from "./auth";
import { can, type Capability, type GlobalRole } from "./rbac";
import { isSessionStillValid } from "./session-validity";

/**
 * The signed-in person, their role, and whether their session is still allowed
 * to act — in one query, done once per render.
 *
 * Thirteen pages were repeating `getActor()` → re-fetch the row for the role →
 * `can()` → `notFound()`, which is both the duplication and the reason session
 * revocation had nowhere obvious to live. Folding the revocation check into a
 * query every one of those pages already makes means it costs no extra round
 * trip.
 *
 * ## Why the role is re-read from the database
 *
 * The JWT carries a role, and it is twelve hours stale by design. Demoting
 * somebody has to take effect on their next request, not on their next login,
 * so the session is used for identity and the database for authority.
 *
 * ## Why React's `cache()` and not `unstable_cache()`
 *
 * `cache()` deduplicates within a single render pass, so a layout and its page
 * share one query and nothing is retained afterwards. `unstable_cache` persists
 * ACROSS requests, which for per-user authorisation data would mean one
 * person's role answering another person's request.
 */
export const loadPageActor = cache(async () => {
  const actor = await getActor();
  if (!actor) return null;

  const [row] = await db
    .select({
      globalRole: users.globalRole,
      name: users.name,
      isActive: users.isActive,
      accessExpiresAt: users.accessExpiresAt,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const verdict = isSessionStillValid(
    // Absent on a token minted before session_version existed. 0 matches no
    // row, so those sessions are treated as revoked -- which they are.
    { sessionVersion: actor.sessionVersion ?? 0 },
    row ?? null,
  );
  // A revoked session is signed out, not merely refused: the token is no longer
  // evidence of anything, so treating it as anonymous is the honest reading.
  if (!verdict.valid) return null;

  return {
    id: actor.id,
    name: row!.name,
    globalRole: row!.globalRole as GlobalRole,
    accessExpiresAt: row!.accessExpiresAt,
  };
});

export type PageActor = NonNullable<Awaited<ReturnType<typeof loadPageActor>>>;

/**
 * The actor, or the login page.
 *
 * The two failures are deliberately different. Missing the CAPABILITY is a 404
 * — a non-admin should not learn that an admin area exists. Having no valid
 * SESSION is not a refusal at all: the person was signed out, usually because
 * an admin deactivated them or they changed their password elsewhere, and a
 * 404 would tell them nothing about a thing they can fix in ten seconds.
 *
 * The proxy cannot catch this case. It sees a structurally valid JWT and lets
 * the request through; only this lookup knows the row behind it has moved on.
 */
export async function requirePageActor(): Promise<PageActor> {
  const actor = await loadPageActor();
  if (!actor) redirect("/login");
  return actor;
}

/** The actor, or a 404 unless they hold the capability. */
export async function requireCapability(
  capability: Capability,
): Promise<PageActor> {
  const actor = await requirePageActor();
  if (!can(actor.globalRole, capability)) notFound();
  return actor;
}

/**
 * For server actions, where a 404 is meaningless — nothing is being navigated
 * to. Throws the error the action-error helper already knows how to shape.
 */
export async function requireActingActor(): Promise<PageActor> {
  const actor = await loadPageActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}
