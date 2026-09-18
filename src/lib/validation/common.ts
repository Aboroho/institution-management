import { z } from "zod";

export const cuid = z.string().min(1, "Required");
export const email = z.string().email("Invalid email");

/**
 * Password policy — the single source of truth for every endpoint that accepts a
 * password (account creation, admin creation, password change). Backend schemas and
 * the mirroring frontend forms both use these fields, so client and server can never
 * drift apart. `max` exists because bcrypt only reads the first 72 bytes of a
 * password: longer input would be silently truncated instead of rejected.
 */
export const passwordMinLength = 8;
export const passwordMaxLength = 72;

export const passwordField = z
  .string({
    required_error: "Password is required",
    invalid_type_error: "Password is required",
  })
  .min(passwordMinLength, `Password must be at least ${passwordMinLength} characters`)
  .max(passwordMaxLength, `Password must be at most ${passwordMaxLength} characters`);

/** Name as shown across the UI. Trimmed, so " Ada " and "Ada" cannot both exist. */
export const personNameField = z
  .string({ required_error: "Name is required", invalid_type_error: "Name is required" })
  .trim()
  .min(1, "Name is required")
  .max(120, "Name must be at most 120 characters");

/** Account email. Normalized (trim + lowercase) before uniqueness is checked. */
export const accountEmailField = z
  .string({ required_error: "Email is required", invalid_type_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .max(254, "Email must be at most 254 characters")
  .email("Enter a valid email address");

/** Canonical email form for storage and lookups. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
});

export const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

/**
 * Student roll number: required, positive whole number. Uniqueness is scoped to the section
 * and enforced by the database (`StudentEnrollment @@unique([sectionId, rollNumber])`).
 */
export const rollNumber = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : Number(trimmed);
    }
    return value;
  },
  z
    .number({ required_error: "Roll number is required", invalid_type_error: "Roll number must be a number" })
    .int("Roll number must be a whole number")
    .min(1, "Roll number must be 1 or greater")
    .max(999999, "Roll number is too large"),
);

export function searchFilter(search?: string, fields: string[] = []) {
  if (!search || fields.length === 0) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: search, mode: "insensitive" as const } })) };
}
