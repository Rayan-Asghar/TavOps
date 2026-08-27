import { z } from "zod";
import { globalRole } from "@/db/schema";

export const ASSIGNABLE_ROLES = globalRole.enumValues;

/** Shown next to each option: role names alone do not tell an admin what they
 *  are granting, and a wrong guess here is how people over-provision. */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access, including pay rates and user management.",
  head: "Runs the company. All projects, financials, reviews and pipeline.",
  sales: "Only projects they own. Their own activity.",
  developer: "Only projects they are assigned to. Their own activity.",
  collaborator: "Temporary contractor. Set an access expiry.",
};

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the person's name."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("That does not look like an email address."),
    globalRole: z.enum(ASSIGNABLE_ROLES),
    weeklyCapacityHours: z.coerce.number().int().min(0).max(80).default(40),
    /** Empty string from the form means "no expiry". */
    accessExpiresAt: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? new Date(v) : null)),
  })
  .refine(
    (v) => v.globalRole !== "collaborator" || v.accessExpiresAt !== null,
    {
      message: "Collaborators need an access expiry date.",
      path: ["accessExpiresAt"],
    },
  )
  .refine((v) => !v.accessExpiresAt || v.accessExpiresAt > new Date(), {
    message: "The expiry date must be in the future.",
    path: ["accessExpiresAt"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
