import { z } from "zod";

/**
 * Outside the `"use server"` action module for the reason `schemas.ts` gives:
 * those files may only export async functions.
 */

/** Money as typed: up to 2dp, non-negative. Kept a string end to end so it
 *  reaches `numeric(10,2)` without ever being a float. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Use an amount like 12.50.");

export const setUserRateSchema = z.object({
  userId: z.string().uuid(),
  internalCostPerHour: amount,
  /** Blank means "no rate card": cost is known, revenue is not. Not zero. */
  billableRatePerHour: amount.optional().or(z.literal("")),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.")
    .default("USD"),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date this rate starts."),
});

export type SetUserRateInput = z.infer<typeof setUserRateSchema>;
