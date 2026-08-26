import { z } from "zod";

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v) : null));

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(3, "Give the task a title."),
  description: z.string().trim().max(4000).optional(),
  assigneeId: optionalUuid,
  estimatedHours: z.coerce.number().min(0).max(500).optional(),
  dueDate: optionalDate,
  priority: z.coerce.number().int().min(1).max(5).default(3),
  /** Row in the client's sheet, for update-mode syncs. */
  sheetRowRef: z.string().trim().max(60).optional(),
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(3).optional(),
  description: z.string().trim().max(4000).optional(),
  assigneeId: optionalUuid,
  estimatedHours: z.coerce.number().min(0).max(500).optional(),
  dueDate: optionalDate,
  priority: z.coerce.number().int().min(1).max(5).optional(),
  status: z
    .enum(["todo", "in_progress", "blocked", "in_review", "done"])
    .optional(),
});

export const reviewSchema = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(["approved", "revision_needed"]),
  comments: z.string().trim().max(2000).optional(),
})
  .refine(
    (v) => v.decision !== "revision_needed" || (v.comments?.length ?? 0) >= 5,
    {
      // Sending work back without saying why guarantees a second round trip.
      message: "Say what needs changing — a rejection with no reason bounces.",
      path: ["comments"],
    },
  );

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(3, "Give the project a name."),
    clientId: optionalUuid,
    newClientName: z.string().trim().max(200).optional(),
    projectType: z.string().trim().max(80).optional(),
    pmId: optionalUuid,
    deliveryLeadId: optionalUuid,
    salesOwnerId: optionalUuid,
    internalDueDate: optionalDate,
    clientDueDate: optionalDate,
    description: z.string().trim().max(4000).optional(),
  })
  .refine(
    (v) =>
      !v.internalDueDate ||
      !v.clientDueDate ||
      v.internalDueDate <= v.clientDueDate,
    {
      message: "The internal deadline must be on or before the client deadline.",
      path: ["internalDueDate"],
    },
  );

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type ReviewInput = z.input<typeof reviewSchema>;
