import { z } from "zod";

export const cuid = z.string().min(1, "Required");
export const email = z.string().email("Invalid email");
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
});

export const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export function searchFilter(search?: string, fields: string[] = []) {
  if (!search || fields.length === 0) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: search, mode: "insensitive" as const } })) };
}
