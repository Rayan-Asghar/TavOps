import { z } from "zod";

/** Money as typed. Kept a string end to end so it reaches `numeric` without
 *  ever having been a float. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Use an amount like 12500.00");

const optionalAmount = z.union([amount, z.literal("")]);
const hours = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Use hours like 160.00");

export const setProjectMoneySchema = z.object({
  projectId: z.string().uuid(),
  billingModel: z.enum(["time_and_materials", "fixed_fee", "retainer"]),
  /** Blank clears the figure rather than storing zero — "not agreed yet" and
   *  "agreed at nothing" are different facts. */
  contractValue: optionalAmount,
  platformFeePct: z
    .union([
      z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a percentage like 10"),
      z.literal(""),
    ])
    .optional(),
  budgetedHours: z.union([hours, z.literal("")]).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.")
    .default("USD"),
});

export const upsertRetainerPeriodSchema = z
  .object({
    projectId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
    includedHours: z.union([hours, z.literal("")]).optional(),
    amount: optionalAmount.optional(),
    rolloverHours: z.union([hours, z.literal("")]).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.")
      .default("USD"),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "A period cannot end before it starts.",
    path: ["periodEnd"],
  });

export const BILLING_MODEL_LABELS = {
  time_and_materials: "Time & materials",
  fixed_fee: "Fixed fee",
  retainer: "Retainer",
} as const;

/** What each model means for how the project is measured. Shown in the form so
 *  the choice is made once, knowingly, rather than left on the default. */
export const BILLING_MODEL_NOTES = {
  time_and_materials:
    "Billed for the hours worked. Budgeted hours are a cap to watch, not a price.",
  fixed_fee: "One agreed price. Margin is the contract less what it costs to deliver.",
  retainer:
    "A recurring period with hours included. Budget and margin are measured per period, never over the project's life.",
} as const;
