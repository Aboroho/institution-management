export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listAssignments, assignTeacher } from "@/modules/teachers/teachers.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const isActive = s.get("isActive");
    const { items, total } = await listAssignments({
      teacherId: s.get("teacherId") || undefined, courseOfferingId: s.get("courseOfferingId") || undefined,
      isActive: isActive === null ? undefined : isActive === "true", page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({ courseOfferingId: z.string().min(1), teacherId: z.string().min(1), reason: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await assignTeacher({ ...body, assignedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "teacherAssignment.create", entityType: "TeacherCourseAssignment", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
