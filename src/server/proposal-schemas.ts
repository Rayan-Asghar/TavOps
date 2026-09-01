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

export const advanceProposalSchema = z.object({
  proposalId: z.string().uuid(),
  status: z.enum(PROPOSAL_STATUSES),
  wonValue: z.coerce.number().min(0).optional(),
});

export type CreateProposalInput = z.input<typeof createProposalSchema>;
