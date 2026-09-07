import { z } from "zod";

export const PROPOSAL_STATUSES = [
  "sent",
  "viewed",
  "responded",
  "meeting",
  "qualified",
  "won",
  "lost",
] as const;

/** Where each status sits in the funnel, for conversion maths and ordering. */
export const STATUS_RANK: Record<string, number> = {
  sent: 0,
  viewed: 1,
  responded: 2,
  meeting: 3,
  qualified: 4,
  won: 5,
  lost: 5,
};

export const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  viewed: "Viewed",
  responded: "Responded",
  meeting: "Meeting booked",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export const createProposalSchema = z.object({
  jobTitle: z.string().trim().min(3, "What was the job?"),
  jobUrl: z
    .string()
    .trim()
    .url("That does not look like a link.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  category: z.string().trim().max(80).optional(),
  source: z.string().trim().max(40).default("upwork"),
  budgetAmount: z.coerce.number().min(0).max(10_000_000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const LOST_REASONS = [
  "price",
  "no_response",
  "client_hired_other",
  "client_cancelled",
  "timeline",
  "scope_mismatch",
  "other",
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

/**
 * Phrased from our side, not the client's, because the rep picking one is
 * answering "what happened" rather than filing a complaint.
 */
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: "Too expensive",
  no_response: "Never heard back",
  client_hired_other: "Hired someone else",
  client_cancelled: "Cancelled the job",
  timeline: "Timeline did not work",
  scope_mismatch: "Not what we do",
  other: "Something else",
};

export const advanceProposalSchema = z
  .object({
    proposalId: z.string().uuid(),
    status: z.enum(PROPOSAL_STATUSES),
    wonValue: z.coerce.number().min(0).optional(),
    lostReason: z.enum(LOST_REASONS).optional(),
    lostNote: z.string().trim().max(500).optional(),
  })
  /* A loss with no reason is the row that teaches nothing, which is the whole
     point of recording losses. The database enforces this too — this is here so
     the rep is told which field, not handed a constraint violation. */
  .refine((v) => v.status !== "lost" || v.lostReason !== undefined, {
    message: "Why was it lost?",
    path: ["lostReason"],
  });

export const markChasedSchema = z.object({
  proposalId: z.string().uuid(),
});

/**
 * Links a proposal to a client that already exists.
 *
 * There is deliberately no `newClientName` here, unlike the handoff schema. A
 * rep gets visibility of the client list, not ownership of it: creating a
 * client is a consequence of winning work, and it happens in the handoff where
 * a project is created to hang it on.
 */
export const linkProposalClientSchema = z.object({
  proposalId: z.string().uuid(),
  // Empty string is the "no client" option in the select, not a missing field.
  clientId: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
});

/** The pipeline views. `chase` is the default, which is why it is first. */
export const PROPOSAL_VIEWS = ["chase", "open", "won", "lost", "all"] as const;
export type ProposalView = (typeof PROPOSAL_VIEWS)[number];

export const VIEW_LABEL: Record<ProposalView, string> = {
  chase: "Needs a chase",
  open: "Open",
  won: "Won",
  lost: "Lost",
  all: "All",
};

export type ProposalStatusName = (typeof PROPOSAL_STATUSES)[number];

/** The five a chase can apply to: everything that is not yet decided. */
export const OPEN_STATUSES = [
  "sent",
  "viewed",
  "responded",
  "meeting",
  "qualified",
] as const satisfies readonly ProposalStatusName[];

/** Which statuses each view admits. `chase` narrows further, by the clock. */
export const VIEW_STATUSES: Record<
  ProposalView,
  readonly [ProposalStatusName, ...ProposalStatusName[]] | null
> = {
  chase: OPEN_STATUSES,
  open: OPEN_STATUSES,
  won: ["won"],
  lost: ["lost"],
  all: null,
};

export type CreateProposalInput = z.input<typeof createProposalSchema>;

/**
 * One inbox key per proposal PER CHASE CYCLE.
 *
 * The cycle number is load-bearing, not decoration. `notify()` upserts on
 * (user_id, dedupe_key) and on conflict only clears a snooze — it does not
 * clear `resolved_at`. So a key that were merely `followup:<id>` would work
 * exactly once: the rep chases, the row resolves, the client stays silent, the
 * clock runs out again, and the sweep's insert hits the resolved row and writes
 * nothing. The queue would be a one-shot, which is worse than not having one.
 *
 * Each cycle is a genuinely different ask, so it gets its own key. Resolved
 * rows from earlier cycles stay as history, which is what they are.
 *
 * Lives here rather than beside the action that writes it because a "use
 * server" module may only export async functions — the same reason every other
 * schema and label in this file is not in `proposals.ts`.
 */
export function chaseDedupeKey(proposalId: string, chaseCount: number): string {
  return `followup:${proposalId}:${chaseCount}`;
}
