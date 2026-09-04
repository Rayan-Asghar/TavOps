import type { notificationKind } from "@/db/schema";

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

/** Every kind the schema allows. Deriving it means adding a value to the enum
 *  fails to compile until it has been given a label and a stream. */
export type NotificationKind = (typeof notificationKind.enumValues)[number];

/**
 * Notification kinds, as the inbox presents them.
 *
 * `Record<NotificationKind, …>` rather than `Record<string, …>`, and that is
 * load-bearing: with `string` this map silently covered 9 of the 15 kinds, and
 * the missing six rendered their raw enum name as a label. The compiler now
 * refuses a partial map.
 */
export const KIND_META: Record<
  NotificationKind,
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
  feasibility_requested: { label: "Feasibility", tone: "violet", signal: "review" },
  feasibility_answered: { label: "Answered", tone: "green", signal: "review" },
  followup_due: { label: "Follow-up", tone: "amber", signal: "warning" },
  timer_left_running: { label: "Timer running", tone: "amber", signal: "warning" },
  review_approved: { label: "Approved", tone: "green", signal: "review" },
  revision_requested: { label: "Changes asked", tone: "violet", signal: "review" },
};

/** Title-cases an enum value: `tech_lead` becomes "Tech Lead". */
export function humanizeRole(role: string): string {
  return role
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Named streams for the Needs Attention queue.
 *
 * DESIGN-STANDARD 2.5, from Superhuman's split inboxes: "so zero is reachable
 * per-stream". One undifferentiated pile can only be empty all at once, which on
 * a two-person team means effectively never — and a queue that is never empty
 * stops being read. Three streams, each of which can be honestly finished on its
 * own, is the point.
 *
 * Split by what the item asks of you, not by severity: something is either
 * blocking a person, waiting on your judgement, or drifting. Severity is already
 * carried by the row's stripe.
 */
export type StreamKey = "blocked" | "attention" | "slipping";

export const STREAMS: {
  key: StreamKey;
  label: string;
  /** What finishing this stream means, for its cleared state. */
  cleared: string;
}[] = [
  {
    key: "blocked",
    label: "Blocked",
    cleared: "Nobody is waiting on an unblock.",
  },
  {
    key: "attention",
    label: "Waiting on you",
    cleared: "Nothing is waiting on your call.",
  },
  {
    key: "slipping",
    label: "Slipping",
    cleared: "Nothing is drifting.",
  },
];

/**
 * Which stream each kind belongs to.
 *
 * Exhaustive over the enum on purpose. The first version listed kinds per stream
 * and fell back to `slipping` for anything unlisted, which silently put
 * "Assigned: About Page" under Slipping — being handed a task is not a slip, and
 * the person reading it went looking for a problem that did not exist. Eight of
 * the fifteen kinds were landing there.
 *
 * A fallback is the wrong shape for this: miscategorising quietly is worse than
 * failing to build. Adding a kind to the enum now breaks the compile until it is
 * placed here deliberately.
 */
export const STREAM_OF: Record<NotificationKind, StreamKey> = {
  // Someone is stuck and needs a person to move.
  blocker_opened: "blocked",
  blocker_escalated: "blocked",

  // Waiting on your judgement or your hands.
  task_needs_review: "attention",
  task_assigned: "attention",
  feasibility_requested: "attention",
  revision_requested: "attention",
  followup_due: "attention",

  // Drifting on its own, with nobody yet asking.
  task_stalled: "slipping",
  update_missing: "slipping",
  project_at_risk: "slipping",
  sync_failed: "slipping",
  timer_left_running: "slipping",

  // Resolutions. These arrive non-actionable and read in the Recent feed rather
  // than the queue, but they still need a home if one is ever raised actionable.
  blocker_resolved: "attention",
  review_approved: "attention",
  feasibility_answered: "attention",
};

export function streamOf(kind: string): StreamKey {
  return STREAM_OF[kind as NotificationKind] ?? "attention";
}

/**
 * Meta for a kind that arrived as a plain string — from a database row, where
 * the enum has been widened to `string` on the way through.
 *
 * The fallback is a genuine unknown rather than a guess at a category: label it
 * as the raw kind so it is obviously unhandled, and give it the quietest signal
 * so an unrecognised row cannot shout.
 */
export function metaFor(kind: string): { label: string; tone: Tone; signal: Signal } {
  return (
    KIND_META[kind as NotificationKind] ?? {
      label: kind.replace(/_/g, " "),
      tone: "neutral",
      signal: "waiting",
    }
  );
}
