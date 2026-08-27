/**
 * Blocker routing.
 *
 * Deliberately a pure function over a resolved context: no database, no auth,
 * no clock. The routing matrix is the part most likely to be argued about and
 * changed, so it has to be readable in one screen and testable without a
 * server. The caller resolves who holds which role and passes it in.
 *
 * The output distinguishes the **assignee** — one person, the SLA clock sits on
 * them — from **watchers**, who are told but not accountable. "Notify everyone"
 * produces an inbox nobody reads; one owner plus context does not.
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
  /** Holders of project-scoped roles, which override the project owners when
   *  present — a project's own technical overseer beats the default lead. */
  projectRoles: {
    tech_lead?: string | null;
    qa?: string | null;
    sales_owner?: string | null;
    pm?: string | null;
  };
  /**
   * Leads of every team the reporter belongs to. Teams overlap, so this is a
   * list rather than a single id — the tie is broken by preferring the lead who
   * is also on this project.
   */
  reporterTeamLeadIds?: string[];
  /** dependency_dev only: whose work this is waiting on, and their lead. */
  blockedOnUserId?: string | null;
  blockedOnUserLeadId?: string | null;
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

/** Business hours to first response, by severity. */
const SLA_HOURS: Record<BlockerSeverity, number> = {
  critical: 1,
  high: 4,
  normal: 8,
  low: 16,
};

/** Categories the client owns. These pause the delivery clock. */
const CLIENT_OWNED: BlockerCategory[] = [
  "missing_access",
  "missing_asset",
  "client_approval",
  "waiting_on_client",
];

function firstOf(...ids: (string | null | undefined)[]): string | null {
  for (const id of ids) if (id) return id;
  return null;
}

/** Drops empty values, duplicates, and the assignee — nobody is their own
 *  watcher — and never notifies the reporter about their own report. */
function cleanWatchers(
  candidates: (string | null | undefined)[],
  assigneeId: string | null,
  reporterId: string,
): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    if (!c) continue;
    if (c === assigneeId) continue;
    if (c === reporterId) continue;
    out.add(c);
  }
  return [...out];
}

/**
 * Picks one lead when the reporter sits in several teams.
 *
 * Prefers a lead who is also attached to this project: if Ayan is in both the
 * Shopify and Automation teams, a blocker on a Shopify project should reach the
 * lead who is actually on it rather than whichever team was created first.
 */
function preferredTeamLead(
  teamLeadIds: string[],
  projectPeople: (string | null | undefined)[],
): string | null {
  if (teamLeadIds.length === 0) return null;
  const onProject = new Set(projectPeople.filter(Boolean) as string[]);
  return teamLeadIds.find((id) => onProject.has(id)) ?? teamLeadIds[0];
}

export function resolveBlockerRouting(ctx: RoutingContext): RoutingResult {
  const { project: p, projectRoles: r } = ctx;

  const teamLead = preferredTeamLead(ctx.reporterTeamLeadIds ?? [], [
    p.pmId,
    p.deliveryLeadId,
    p.salesOwnerId,
    r.tech_lead,
    r.qa,
    r.pm,
    r.sales_owner,
  ]);

  // Order of preference: a role holder on this project, then the reporter's own
  // team lead, then the project-level default.
  const techOwner = firstOf(r.tech_lead, teamLead, p.deliveryLeadId, p.pmId);
  const qaOwner = firstOf(r.qa, r.tech_lead, teamLead, p.deliveryLeadId, p.pmId);
  const clientOwner = firstOf(r.sales_owner, p.salesOwnerId, p.pmId, teamLead);
  const pmOwner = firstOf(r.pm, p.pmId, teamLead, p.deliveryLeadId);

  let assigneeId: string | null = null;
  let watchers: (string | null | undefined)[] = [];
  let rule = "default";
  let explanation = "";

  switch (ctx.category) {
    case "missing_access":
    case "missing_asset":
    case "client_approval":
    case "waiting_on_client":
      // Whoever talks to the client chases the client. The developer has done
      // their job by reporting it.
      assigneeId = clientOwner;
      watchers = [pmOwner];
      rule = "client_dependency";
      explanation =
        "Client-owned dependency, routed to whoever owns client communication on this project.";
      break;

    case "technical":
      assigneeId = techOwner;
      watchers = [p.pmId];
      rule = "technical";
      explanation =
        "Technical implementation issue, routed to the project's technical overseer.";
      break;

    case "qa_issue":
      assigneeId = qaOwner;
      watchers = [p.deliveryLeadId];
      rule = "qa";
      explanation = "QA issue, routed to the project's reviewer.";
      break;

    case "dependency_dev":
      // The person who can actually unblock it is the other developer; their
      // lead is told so it does not stall silently between two peers.
      assigneeId = firstOf(ctx.blockedOnUserId, techOwner);
      watchers = [ctx.blockedOnUserLeadId, teamLead, p.deliveryLeadId];
      rule = "dependency_dev";
      explanation =
        "Waiting on another developer's work, routed to them with their lead copied.";
      break;

    case "unclear_requirement":
    case "scope_conflict":
    case "needs_decision":
      assigneeId = pmOwner;
      watchers = [p.deliveryLeadId];
      rule = "scope";
      explanation =
        "Scope or requirement question, routed to the PM with the delivery lead copied.";
      break;

    case "commercial_scope":
      // Something sales promised. The rep answers; the PM needs to know because
      // it usually means a change request.
      assigneeId = clientOwner;
      watchers = [pmOwner];
      rule = "commercial";
      explanation =
        "Commercial or sales-promise issue, routed to the deal owner with the PM copied.";
      break;

    case "production_incident":
      assigneeId = firstOf(p.deliveryLeadId, r.tech_lead, teamLead, p.pmId);
      watchers = [p.pmId, r.tech_lead];
      rule = "incident";
      explanation =
        "Production incident, routed to the delivery lead with the PM notified immediately.";
      break;

    default:
      // Nothing specific matched, so it goes to the reporter's own lead — the
      // person who knows what they are working on.
      assigneeId = firstOf(teamLead, p.deliveryLeadId, p.pmId);
      watchers = [p.pmId];
      rule = teamLead ? "team_lead" : "default";
      explanation = teamLead
        ? "No specialist rule matched, routed to the reporter's team lead."
        : "No specific rule matched, routed to the project lead.";
  }

  // The reporter's lead is always at least copied, whatever the category. A
  // lead should never find out second-hand that one of their people is stuck.
  if (teamLead && teamLead !== assigneeId) watchers.push(teamLead);

  // A production incident is critical regardless of what was ticked.
  const severity: BlockerSeverity =
    ctx.category === "production_incident" && ctx.severity !== "critical"
      ? "critical"
      : ctx.severity;

  return {
    assigneeId,
    watcherIds: cleanWatchers(watchers, assigneeId, ctx.reporterId),
    ownerSide: CLIENT_OWNED.includes(ctx.category) ? "client" : "internal",
    slaHours: SLA_HOURS[severity],
    rule,
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
