import type { globalRole, projectRole } from "@/db/schema";

export type GlobalRole = (typeof globalRole.enumValues)[number];
export type ProjectRole = (typeof projectRole.enumValues)[number];

/**
 * Capabilities are the vocabulary the app checks against. Never branch on a
 * role name directly in a route or component — ask for the capability, so that
 * adding a role later is one edit here rather than a grep across the codebase.
 */
export const CAPABILITIES = [
  "project.create",
  "project.edit",
  "project.viewAll",
  "project.manageMembers",
  "task.create",
  "task.assign",
  "task.edit",
  "worklog.create",
  "worklog.viewAll",
  "blocker.create",
  "blocker.resolve",
  "review.approve",
  "sheet.configure",
  "team.manage",
  "deadline.viewClient",
  "proposal.create",
  "proposal.viewAll",
  "feasibility.answer",
  "finance.view",
  "rates.view",
  "user.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Global role -> capability grants.
 *
 * There are five roles, not seven. Hozefa, Hammad and Muzammil share `head`
 * because they run the company together; splitting them into PM / delivery
 * lead / sales head encoded a division of labour that does not hold in
 * practice. What each of them owns is decided per project and per team, which
 * is where the real distinction lives.
 *
 * `rates.view` stays admin-only. The heads are partners and may well want it —
 * it is one line here — but pay data is not granted by inference.
 */
const ROLE_CAPABILITIES: Record<GlobalRole, readonly Capability[]> = {
  admin: CAPABILITIES,

  head: [
    "project.create",
    "project.edit",
    "project.viewAll",
    "project.manageMembers",
    "team.manage",
    "task.create",
    "task.assign",
    "task.edit",
    "worklog.create",
    "worklog.viewAll",
    "blocker.create",
    "blocker.resolve",
    "review.approve",
    "sheet.configure",
    "deadline.viewClient",
    "proposal.create",
    "proposal.viewAll",
    "feasibility.answer",
    "finance.view",
    "audit.view",
  ],

  sales: [
    "blocker.create",
    "worklog.create",
    "proposal.create",
    "deadline.viewClient",
  ],

  developer: ["worklog.create", "blocker.create", "task.edit"],

  collaborator: ["worklog.create", "blocker.create"],
};

const CAPABILITY_SETS = Object.fromEntries(
  Object.entries(ROLE_CAPABILITIES).map(([role, caps]) => [
    role,
    new Set<Capability>(caps),
  ]),
) as Record<GlobalRole, Set<Capability>>;

export function can(role: GlobalRole, capability: Capability): boolean {
  return CAPABILITY_SETS[role]?.has(capability) ?? false;
}

export class ForbiddenError extends Error {
  constructor(capability: Capability) {
    super(`Missing capability: ${capability}`);
    this.name = "ForbiddenError";
  }
}

/** Throwing variant for server actions and route handlers. */
export function assertCan(role: GlobalRole, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError(capability);
}

/**
 * Roles that see every project without being a member. Everyone else needs an
 * explicit membership row or an owner field pointing at them — this is what
 * stops a developer from walking project IDs in the URL bar.
 */
/**
 * Who may see the client-facing deadline.
 *
 * The internal date is the buffer. A developer who can see both knows the real
 * deadline is the later one, which is exactly the slack the buffer exists to
 * hold — so they see the internal date only, and it is labelled plainly as
 * "Deadline". Calling it "internal" to someone who cannot see the other one
 * just advertises that a second date exists.
 */
export const ORG_WIDE_ROLES: readonly GlobalRole[] = ["admin", "head"];

export function seesAllProjects(role: GlobalRole): boolean {
  return ORG_WIDE_ROLES.includes(role);
}
