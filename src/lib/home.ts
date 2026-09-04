import type { Capability, GlobalRole } from "@/lib/rbac";
import { can } from "@/lib/rbac";

/**
 * Where a person's day starts.
 *
 * `/` is the right front door for anyone who delivers: it is the attention
 * inbox, and a missed escalation costs more than a missed follow-up. But a
 * sales rep has never had anything on it — their blockers are somebody else's
 * projects and their pipeline is not represented there at all — so they were
 * landing on a screen that was empty by construction.
 *
 * Matched by CAPABILITY, in order, so that adding a sixth role stays one edit
 * in `rbac.ts`. Never branch on a role name here.
 *
 * This does NOT redirect `/` itself, deliberately. The follow-up sweep writes
 * into the inbox and the rail badge counts what is waiting there; hijacking `/`
 * would leave a rep's own notifications with nowhere to land.
 */
const HOMES: readonly { capability: Capability; href: string }[] = [
  { capability: "worklog.create", href: "/" },
  { capability: "proposal.create", href: "/sales" },
];

/** The fallback is the inbox: it is the one screen no capability gates. */
export const DEFAULT_HOME = "/";

export function homePathFor(role: GlobalRole): string {
  return HOMES.find((h) => can(role, h.capability))?.href ?? DEFAULT_HOME;
}
