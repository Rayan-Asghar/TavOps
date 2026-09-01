import { z } from "zod";

/**
 * Validation schemas live outside the "use server" modules on purpose: those
 * files may only export async functions, so exporting a Zod object from one
 * makes the whole action module fail to load at call time.
 */

export const logWorkSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  hours: z.coerce.number().min(0.01, "Log at least a minute.").max(24),
  /** What the team and reviewers read. The only note a work log carries. */
  internalNotes: z.string().trim().min(3, "Say what you did, even briefly."),
  resultingStatus: z
    .enum(["todo", "in_progress", "blocked", "in_review", "done"])
    .nullable()
    .optional(),
});

export type LogWorkInput = z.infer<typeof logWorkSchema>;

/**
 * Correcting an entry.
 *
 * The reason is required, for the same argument as the timer's adjustment: a
 * revision chain that records what changed but never why answers the easy half
 * of "what happened here" and leaves the half anyone actually asks.
 */
export const editWorkLogSchema = z.object({
  workLogId: z.string().uuid(),
  hours: z.coerce.number().min(0.01, "Log at least a minute.").max(24),
  internalNotes: z.string().trim().min(3, "Say what you did, even briefly."),
  /** Optional: only sent when the entry was filed against the wrong day. */
  workDate: z.coerce.date().optional(),
  reason: z.string().trim().min(3, "Say why this entry is changing."),
});

export type EditWorkLogInput = z.input<typeof editWorkLogSchema>;

export const deleteWorkLogSchema = z.object({
  workLogId: z.string().uuid(),
  reason: z.string().trim().min(3, "Say why this entry is being removed."),
});

export type DeleteWorkLogInput = z.infer<typeof deleteWorkLogSchema>;

export const reportBlockerSchema = z
  .object({
    projectId: z.string().uuid(),
    taskId: z.string().uuid().nullable().optional(),
    category: z.enum([
      "missing_access",
      "missing_asset",
      "client_approval",
      "waiting_on_client",
      "unclear_requirement",
      "scope_conflict",
      "needs_decision",
      "commercial_scope",
      "technical",
      "qa_issue",
      "dependency_dev",
      "production_incident",
      "other",
    ]),
    severity: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    /** Required when the blocker is another developer's unfinished work —
     *  without it there is nobody to route to. */
    blockedOnUserId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    description: z.string().trim().min(5, "Describe what you are blocked on."),
  })
  .refine(
    (v) => v.category !== "dependency_dev" || !!v.blockedOnUserId,
    {
      message: "Say which developer you are waiting on.",
      path: ["blockedOnUserId"],
    },
  );

export type ReportBlockerInput = z.input<typeof reportBlockerSchema>;

export const resolveBlockerSchema = z.object({
  blockerId: z.string().uuid(),
  resolutionNote: z.string().trim().min(3),
});

export type ResolveBlockerInput = z.infer<typeof resolveBlockerSchema>;
