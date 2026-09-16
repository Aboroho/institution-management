import { z } from "zod";

/**
 * Account/profile management input contracts. Every schema is `.strict()` —
 * unknown fields are rejected (mass-assignment guard) — and protected/system
 * fields (role, isSeedAdmin, id, passwordHash, tokenVersion, isActive) are
 * declared as explicit "forbidden" keys so attempts to set them produce a
 * clear per-field error instead of a generic unrecognized-key message.
 */
function forbiddenField(key: string, label: string) {
  return z
    .any()
    .optional()
    .refine((v) => v === undefined, {
      message: `${label} is system-managed and cannot be changed here`,
    })
    .describe(`__forbidden_${key}`);
}

const protectedFields = {
  id: forbiddenField("id", "User ID"),
  userId: forbiddenField("userId", "User ID"),
  role: forbiddenField("role", "Role"),
  isSeedAdmin: forbiddenField("isSeedAdmin", "Protected/system-account status"),
  passwordHash: forbiddenField("passwordHash", "Password hash"),
  tokenVersion: forbiddenField("tokenVersion", "Session state"),
};

/** Emails are normalized exactly like the login flow: trimmed + lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Existing password policy: minimum 8 characters (src/lib/auth/password.ts). */
export const passwordPolicyMessage = "Password must be at least 8 characters";

export const profileUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(80, "Name must be at most 80 characters")
      .optional(),
    email: z.string().trim().min(1, "Required").email("Invalid email").optional(),
    ...protectedFields,
    isActive: forbiddenField("isActive", "Account status"),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.email !== undefined, {
    message: "Provide a new name and/or email",
    path: ["name"],
  });
export type ProfileUpdateInput = Pick<z.infer<typeof profileUpdateSchema>, "name" | "email">;

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, passwordPolicyMessage).max(128, "Password is too long"),
    confirmPassword: z.string().min(1, "Confirm the new password"),
    ...protectedFields,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.newPassword && v.confirmPassword && v.newPassword !== v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "Passwords do not match" });
    }
  });
export type PasswordChangeInput = Pick<
  z.infer<typeof passwordChangeSchema>,
  "currentPassword" | "newPassword" | "confirmPassword"
>;

/**
 * Admin-management "create admin" contract. The created account's role is fixed
 * server-side to ADMIN and the protected seed-admin flag can never be requested
 * from the client.
 */
export const createAdminSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name must be at most 80 characters"),
    email: z.string().trim().min(1, "Required").email("Invalid email"),
    password: z.string().min(8, passwordPolicyMessage).max(128, "Password is too long"),
    ...protectedFields,
    isActive: forbiddenField("isActive", "Account status"),
  })
  .strict();
export type CreateAdminInput = Pick<z.infer<typeof createAdminSchema>, "name" | "email" | "password">;
