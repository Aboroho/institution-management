export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { fail, ok, paginated, parsePagination } from "@/lib/api/response";
import { forbidden } from "@/lib/errors/errors";
import {
  describeNoticeTargetIds,
  listEligibleNoticeRecipients,
  searchNoticeRecipients,
} from "@/modules/notices/notices.service";

const kindSchema = z.enum(["COURSE_OFFERING", "TEACHER", "STUDENT"]);
const targetTypeSchema = z.enum(["EVERYONE", "ADMINS", "COURSE_OFFERING", "TEACHER", "STUDENT"]);
const resolveSchema = z.object({
  targets: z
    .array(z.object({ targetType: targetTypeSchema, targetId: z.string().trim().min(1).max(100) }))
    .max(1000),
});

/**
 * Recipient options for the notice composer.
 *
 * Three shapes, one authorization rule set (enforced in the service, never here):
 *   - no `kind`      -> what this author may target + per-category counts,
 *   - `kind=...`     -> one searchable, paginated page of authorized options,
 *   - POST           -> labels for ids already stored on a notice being edited.
 *
 * Pagination exists so the composer never has to download thousands of students.
 * It is not a security boundary: `createNotice`/`updateNotice` re-validate every
 * submitted id against the same rules.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") throw forbidden("Only staff can select notice recipients");

    const search = req.nextUrl.searchParams;
    const rawKind = search.get("kind");
    if (!rawKind) return ok(await listEligibleNoticeRecipients(auth));

    const kind = kindSchema.parse(rawKind);
    const { page, limit } = parsePagination(search);
    const { items, total } = await searchNoticeRecipients({
      auth,
      kind,
      query: search.get("search") || undefined,
      page,
      limit,
    });
    return paginated(items, page, limit, total);
  } catch (error) {
    return fail(error);
  }
}

/** Resolve stored target ids to display labels (edit mode). */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") throw forbidden("Only staff can select notice recipients");
    const body = resolveSchema.parse(await req.json());
    return ok(await describeNoticeTargetIds(auth, body.targets));
  } catch (error) {
    return fail(error);
  }
}
