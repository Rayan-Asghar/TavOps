import { z } from "zod";

export const convertProposalSchema = z.object({
  proposalId: z.string().uuid(),
  projectName: z.string().trim().min(3, "Give the project a name."),
  /** Blank means "create a new client from the name below". */
  clientId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  newClientName: z.string().trim().max(200).optional(),
  projectType: z.string().trim().max(80).optional(),
  deliveryLeadId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  pmId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  internalDueDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(v) : null)),
  clientDueDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(v) : null)),
  contractValue: z.coerce.number().min(0).max(10_000_000).optional(),
  scope: z.string().trim().max(4000).optional(),
})
  .refine((v) => !!v.clientId || !!v.newClientName, {
    message: "Pick a client or enter a new one.",
    path: ["newClientName"],
  })
  .refine(
    (v) =>
      !v.internalDueDate ||
      !v.clientDueDate ||
      v.internalDueDate <= v.clientDueDate,
    {
      // The internal date is the buffer; if it lands after the client's date it
      // is not a buffer, it is a missed deadline waiting to happen.
      message: "The internal deadline must be on or before the client deadline.",
      path: ["internalDueDate"],
    },
  );

export type ConvertProposalInput = z.infer<typeof convertProposalSchema>;
