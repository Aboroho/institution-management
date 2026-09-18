import { z } from "zod";
import { accountEmailField, normalizeEmail, passwordField, personNameField } from "./common";

/**
 * Request schemas for profile, password and admin-account management.
 *
 * Every schema is `.strict()`: protected system fields (`role`, `isActive`,
 * `isProtectedSeedAdmin`, `sessionVersion`, `passwordHash`, `id`, ...) are NOT part of
 * the input type, and a crafted request that tries to send them is rejected with a
 * validation error instead of being silently stripped — mass assignment is impossible
 * by construction, and the attempt is visible to the caller.
 */

export const updateOwnProfileSchema = z
  .object({
    name: personNameField,
    email: accountEmailField,
  })
  .strict();

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: "Current password is required" })
      .min(1, "Current password is required"),
    newPassword: passwordField,
    confirmPassword: z
      .string({ required_error: "Please confirm the new password" })
      .min(1, "Please confirm the new password"),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "New password and confirmation do not match",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export const createAdminAccountSchema = z
  .object({
    name: personNameField,
    email: accountEmailField,
    password: passwordField,
  })
  .strict();

export type CreateAdminAccountInput = z.infer<typeof createAdminAccountSchema>;

/** Normalizes user input for storage/lookup; used by services (never the client). */
export { normalizeEmail };
