import { z } from "zod";

/**
 * Validation schemas live outside the "use server" modules on purpose: those
 * files may only export async functions, so exporting a Zod object from one
 * makes the whole action module fail to load at call time.
 */

export const logWorkSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  hours: z.coerce.number().positive().max(24),
  /** Internal by default. This is what the team and reviewers read. */
  internalNotes: z.string().trim().min(3, "Say what you did, even briefly."),
  /**
   * Optional, and the ONLY thing that reaches the client's spreadsheet.
   * Leaving it blank means this entry tells the client nothing and no row is
   * written for it — which is the right default for most entries.
   */
  clientUpdate: z
    .string()
    .trim()
    .max(300, "Keep the client line to one sentence.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  resultingStatus: z
    .enum(["todo", "in_progress", "blocked", "in_review", "done"])
    .nullable()
    .optional(),
});

export type LogWorkInput = z.infer<typeof logWorkSchema>;

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
