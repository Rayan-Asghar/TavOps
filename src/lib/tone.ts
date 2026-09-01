/**
 * Status-to-colour, in one place.
 *
 * These maps used to live in six page files. Keeping them together is what
 * makes it possible to notice that two of them disagreed, that one listed
 * three roles the enum cannot produce (`pm`, `delivery_lead`, `sales_head`),
 * and that it was missing one the enum *can* (`head`).
 *
 * The class strings for each tone stay in `components/badges.tsx` — this file
 * decides which tone a thing is, not what that tone looks like.
 */

export type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";

/** Task workflow state. */
export const TASK_TONE: Record<string, Tone> = {
  todo: "neutral",
  in_progress: "blue",
  blocked: "red",
  in_review: "violet",
  done: "green",
};

/** Proposal pipeline stage. */
export const PROPOSAL_TONE: Record<string, Tone> = {
  sent: "neutral",
  viewed: "blue",
  responded: "blue",
  meeting: "violet",
  qualified: "amber",
  won: "green",
  lost: "red",
};

/** `global_role` in the schema — these five and no others. */
export const GLOBAL_ROLE_TONE: Record<string, Tone> = {
  admin: "red",
  head: "violet",
  sales: "blue",
  developer: "neutral",
  collaborator: "amber",
};

/** `project_role` in the schema. Shares the label "pm" with nothing — the
 *  global enum has no such value, so the two maps cannot conflict. */
export const PROJECT_ROLE_TONE: Record<string, Tone> = {
  developer: "neutral",
  tech_lead: "blue",
  qa: "violet",
  pm: "amber",
  sales_owner: "green",
  observer: "neutral",
};

/** How urgently a queue row reads at a glance. */
export type Signal = "critical" | "review" | "warning" | "waiting";

/** Tailwind background for a signal dot. All four are tokens now; `warning`
 *  and `waiting` were loose hex literals repeated across three files. */
export const SIGNAL_COLOR: Record<Signal, string> = {
  critical: "bg-brand",
  review: "bg-info",
  warning: "bg-signal-warn",
  waiting: "bg-fg-muted",
};

/** Notification kinds, as the inbox presents them. */
export const KIND_META: Record<
  string,
  { label: string; tone: Tone; signal: Signal }
> = {
  blocker_opened: { label: "Blocker", tone: "red", signal: "critical" },
  blocker_escalated: { label: "Escalated", tone: "red", signal: "critical" },
  blocker_resolved: { label: "Resolved", tone: "green", signal: "review" },
  task_assigned: { label: "Assigned", tone: "blue", signal: "review" },
  task_needs_review: { label: "Review", tone: "violet", signal: "review" },
  task_stalled: { label: "Stalled", tone: "amber", signal: "warning" },
  update_missing: { label: "Reporting", tone: "amber", signal: "warning" },
  sync_failed: { label: "Sync failed", tone: "red", signal: "critical" },
  project_at_risk: { label: "At risk", tone: "amber", signal: "warning" },
};

/** Title-cases an enum value: `tech_lead` becomes "Tech Lead". */
export function humanizeRole(role: string): string {
  return role
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
