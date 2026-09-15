import { z } from "zod";

export const cuid = z.string().min(1, "Required");
export const email = z.string().email("Invalid email");
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
