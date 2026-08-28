/**
 * Blocker routing.
 *
 * A pure function over a resolved context: no database, no auth, no clock. The
 * caller resolves who holds which role and passes it in, so this is testable
 * without a server and readable in one screen.
 *
 * The output distinguishes the **assignee** — one person, the SLA clock sits on
 * them — from **watchers**, who are told but not accountable. "Notify everyone"
 * produces an inbox nobody reads; one owner plus context does not.
 *
 * ## Why this is smaller than it was
 *
 * This used to be a thirteen-branch matrix with a four-deep role cascade per
 * branch and cross-team lead resolution that broke ties by checking which of a
 * reporter's leads was also on the project. That is the right design for a
 * company with enough people that nobody knows who owns what. Tavren is ten
 * people whose partners speak daily, so the matrix encoded a hierarchy that
 * does not exist and cost a maintenance burden forever.
 *
 * What survives is the part that actually earns its keep: every category lands
 * on exactly one of three owners, one person is copied, and client-owned
 * categories stop the developer's clock.
 */

export type BlockerCategory =
  | "missing_access"
  | "missing_asset"
  | "client_approval"
  | "waiting_on_client"
  | "unclear_requirement"
  | "needs_decision"
  | "scope_conflict"
  | "commercial_scope"
  | "technical"
  | "qa_issue"
  | "dependency_dev"
  | "production_incident"
  | "other";

export type BlockerSeverity = "low" | "normal" | "high" | "critical";

export type RoutingContext = {
  category: BlockerCategory;
  severity: BlockerSeverity;
  reporterId: string;
  /** Owners named on the project record. */
  project: {
    pmId: string | null;
    deliveryLeadId: string | null;
    salesOwnerId: string | null;
  };
  /** Holders of project-scoped roles, which outrank the project defaults — a
   *  project with its own technical overseer routes to them, not the standing
   *  delivery lead. */
  projectRoles: {
    tech_lead?: string | null;
    qa?: string | null;
    sales_owner?: string | null;
    pm?: string | null;
  };
  /** dependency_dev only: whose work this is waiting on. */
  blockedOnUserId?: string | null;
};

export type RoutingResult = {
  assigneeId: string | null;
  watcherIds: string[];
  /** Client-owned blockers stop the developer's clock. */
  ownerSide: "internal" | "client";
  slaHours: number;
  rule: string;
  /** Plain-language reason, shown on the blocker so routing is not a black box. */
  explanation: string;
};

/**
 * Business hours to first response.
 *
 * Kept per-severity rather than collapsed to one window: it is a four-entry
 * lookup, and "everything is stopped" genuinely does deserve a faster clock
 * than "I have other work". This is not where the complexity was.
 */
const SLA_HOURS: Record<BlockerSeverity, number> = {
  critical: 1,
  high: 4,
  normal: 8,
  low: 16,
};

/**
 * Who answers for each category.
 *
 * - `client` — whoever talks to the client, i.e. the sales owner.
 * - `pm` — scope and requirement questions.
 * - `delivery` — anything that is ours to build or fix.
 */
type OwnerKind = "client" | "pm" | "delivery";

const CATEGORY_OWNER: Record<BlockerCategory, OwnerKind> = {
  missing_access: "client",
  missing_asset: "client",
  client_approval: "client",
  waiting_on_client: "client",
  // Something sales promised. Not the client's fault, but the rep answers.
  commercial_scope: "client",

  unclear_requirement: "pm",
  scope_conflict: "pm",
  needs_decision: "pm",

  technical: "delivery",
  qa_issue: "delivery",
  dependency_dev: "delivery",
  production_incident: "delivery",
  other: "delivery",
};

/** Categories the client owns. These pause the delivery clock. */
const CLIENT_OWNED: BlockerCategory[] = [
  "missing_access",
  "missing_asset",
  "client_approval",
  "waiting_on_client",
];

const EXPLANATION: Record<OwnerKind, string> = {
  client:
    "Routed to whoever owns client communication on this project, with the PM copied.",
  pm: "Scope or requirement question, routed to the PM.",
  delivery: "Routed to the project's delivery lead, with the PM copied.",
};

function firstOf(...ids: (string | null | undefined)[]): string | null {
  for (const id of ids) if (id) return id;
  return null;
}

/** A project role holder wins over the project-level default. */
function ownerFor(kind: OwnerKind, ctx: RoutingContext): string | null {
  const { project: p, projectRoles: r } = ctx;
  switch (kind) {
    case "client":
      return firstOf(r.sales_owner, p.salesOwnerId, r.pm, p.pmId, p.deliveryLeadId);
    case "pm":
      return firstOf(r.pm, p.pmId, p.deliveryLeadId);
    case "delivery":
      return firstOf(r.tech_lead, p.deliveryLeadId, p.pmId);
  }
}

export function resolveBlockerRouting(ctx: RoutingContext): RoutingResult {
  const { project: p, projectRoles: r } = ctx;
  const kind = CATEGORY_OWNER[ctx.category];

  // Waiting on a named colleague is the one case where the person who can
  // actually unblock it is neither a lead nor an owner.
  const assigneeId =
    ctx.category === "dependency_dev"
      ? firstOf(ctx.blockedOnUserId, ownerFor("delivery", ctx))
      : ownerFor(kind, ctx);

  // Exactly one person is copied. Normally the PM; when the PM is already the
  // assignee, the delivery lead instead, so somebody always has visibility.
  const pm = firstOf(r.pm, p.pmId);
  const watcher = pm && pm !== assigneeId ? pm : firstOf(p.deliveryLeadId, r.tech_lead);

  const watcherIds =
    watcher && watcher !== assigneeId && watcher !== ctx.reporterId
      ? [watcher]
      : [];

  // A production incident is critical regardless of what was ticked.
  const severity: BlockerSeverity =
    ctx.category === "production_incident" ? "critical" : ctx.severity;

  const explanation =
    ctx.category === "dependency_dev" && ctx.blockedOnUserId
      ? "Waiting on another developer's work, routed to them with the PM copied."
      : EXPLANATION[kind];

  return {
    assigneeId,
    watcherIds,
    ownerSide: CLIENT_OWNED.includes(ctx.category) ? "client" : "internal",
    slaHours: SLA_HOURS[severity],
    rule: ctx.category === "dependency_dev" ? "dependency_dev" : kind,
    explanation,
  };
}

export const CATEGORY_LABELS: Record<BlockerCategory, string> = {
  missing_access: "Missing access or credentials",
  missing_asset: "Client has not sent an asset",
  client_approval: "Waiting on client approval",
  waiting_on_client: "Waiting on the client (other)",
  unclear_requirement: "Requirement is unclear",
  scope_conflict: "Requirements conflict",
  needs_decision: "Needs a decision",
  commercial_scope: "Sales promised something out of scope",
  technical: "Technical problem",
  qa_issue: "QA / review issue",
  dependency_dev: "Waiting on another developer",
  production_incident: "Production is broken",
  other: "Something else",
};

export const SEVERITY_LABELS: Record<BlockerSeverity, string> = {
  low: "Low — I have other work",
  normal: "Normal — slows me down",
  high: "High — I am nearly stopped",
  critical: "Critical — everything is stopped",
};
