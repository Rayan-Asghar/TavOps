import { z } from "zod";

export const startTimerSchema = z.object({
  taskId: z.string().uuid(),
});

export const finishTimerSchema = z.object({
  sessionId: z.string().uuid(),
  note: z.string().trim().min(3, "Add a short note on what you finished."),
  /** Optional, and the only part a client ever sees. See logWorkSchema. */
  clientUpdate: z
    .string()
    .trim()
    .max(300, "Keep the client line to one sentence.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  resultingStatus: z.enum(["in_progress", "in_review", "done"]).default("in_review"),
});

export const adjustTimerSchema = z.object({
  sessionId: z.string().uuid(),
  minutes: z.coerce.number().int().min(1).max(24 * 60),
  reason: z.string().trim().min(5, "Say why the time is being corrected."),
});

export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type FinishTimerInput = z.infer<typeof finishTimerSchema>;
export type AdjustTimerInput = z.infer<typeof adjustTimerSchema>;
