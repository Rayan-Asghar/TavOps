import { z } from "zod";

/**
 * Outside the `"use server"` action module, per the `schemas.ts` convention:
 * those files may only export async functions.
 */

export const changeNameSchema = z.object({
  name: z.string().trim().min(2, "Names are at least two characters.").max(160),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    /**
     * Twelve, not eight. This is an operations system holding client contract
     * values and what every person is paid, and the only factor guarding it —
     * there is no MFA. Length is the cheapest real strength there is, and a
     * minimum nobody would have chosen on their own is the point of a minimum.
     */
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(200, "That is longer than anything needs to be."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Those two do not match.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "That is the password you already have.",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
