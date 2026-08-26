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
  "worklog.viewTeam",
  "blocker.create",
  "blocker.resolve",
  "review.approve",
  "sheet.configure",
  "finance.view",
  "rates.view",
  "user.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Global role -> capability grants.
 *
 * Two corrections against the original spec's permission table, both of which
 * would have blocked real work on day one:
 *
 *  - PM and Delivery Lead were denied `worklog.create`, which would mean Hammad
 *    and Hozefa could never log the hours they actually bill.
 *  - Sales was granted project creation, contradicting the handoff flow where a
 *    project only exists once a deal converts. Sales gets read access to the
 *    projects they own instead.
 */
const ROLE_CAPABILITIES: Record<GlobalRole, readonly Capability[]> = {
  admin: CAPABILITIES,

  pm: [
    "project.create",
    "project.edit",
    "project.viewAll",
    "project.manageMembers",
    "task.create",
    "task.assign",
    "task.edit",
    "worklog.create",
    "worklog.viewTeam",
    "blocker.create",
    "blocker.resolve",
    "review.approve",
    "sheet.configure",
    "finance.view",
    "audit.view",
  ],

  delivery_lead: [
    "project.edit",
    "task.create",
    "task.assign",
    "task.edit",
    "worklog.create",
    "worklog.viewTeam",
    "blocker.create",
    "blocker.resolve",
    "review.approve",
    "sheet.configure",
  ],

  sales: ["blocker.create", "worklog.create"],

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
export const ORG_WIDE_ROLES: readonly GlobalRole[] = ["admin", "pm"];

export function seesAllProjects(role: GlobalRole): boolean {
  return ORG_WIDE_ROLES.includes(role);
}
