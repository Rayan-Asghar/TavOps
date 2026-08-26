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
  notes: z.string().trim().min(3, "Say what you did, even briefly."),
  resultingStatus: z
    .enum(["todo", "in_progress", "blocked", "in_review", "done"])
    .nullable()
    .optional(),
});

export type LogWorkInput = z.infer<typeof logWorkSchema>;

export const reportBlockerSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  category: z.enum([
    "missing_access",
    "unclear_requirement",
    "needs_decision",
    "waiting_on_client",
    "technical",
    "other",
  ]),
  description: z.string().trim().min(5, "Describe what you are blocked on."),
  isUrgent: z.boolean().default(false),
});

export type ReportBlockerInput = z.input<typeof reportBlockerSchema>;

export const resolveBlockerSchema = z.object({
  blockerId: z.string().uuid(),
  resolutionNote: z.string().trim().min(3),
});

export type ResolveBlockerInput = z.infer<typeof resolveBlockerSchema>;
