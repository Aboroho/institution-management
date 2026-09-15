export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail, paginated } from "@/lib/api/response";
import {
  listAttendanceReport,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
} from "@/modules/attendance/attendance.service";

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_ATTENDANCE_PAGE_SIZE).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(["attendanceDate"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

/**
 * GET /api/v1/course-offerings/{id}/attendance/sessions
 *
 * Dedicated Attendance Report listing. Server-side pagination + date filtering.
 * Summary + update count are aggregated in the DB.
 *
 * Authorization:
 *   ADMIN -> any offering
 *   TEACHER -> must be currently assigned to the offering (active)
 *   STUDENT -> forbidden
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const parsed = querySchema.parse({
      page: req.nextUrl.searchParams.get("page") ?? undefined,
      pageSize: req.nextUrl.searchParams.get("pageSize") ?? undefined,
      from: req.nextUrl.searchParams.get("from") ?? undefined,
      to: req.nextUrl.searchParams.get("to") ?? undefined,
      sort: req.nextUrl.searchParams.get("sort") ?? undefined,
      order: req.nextUrl.searchParams.get("order") ?? undefined,
    });
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, params.id);
    else if (auth.role !== "ADMIN") {
      const { AppError } = await import("@/lib/errors/errors");
      return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403));
    }

    const { items, total, page, pageSize } = await listAttendanceReport({
      courseOfferingId: params.id,
      from: parsed.from,
      to: parsed.to,
      page: parsed.page ?? 1,
      pageSize: parsed.pageSize ?? DEFAULT_ATTENDANCE_PAGE_SIZE,
      sort: parsed.sort,
      order: parsed.order,
    });

    return paginated(items, page, pageSize, total);
  } catch (e) {
    return fail(e);
  }
}
