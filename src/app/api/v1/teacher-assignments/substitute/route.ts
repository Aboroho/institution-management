export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { substituteTeacher } from "@/modules/teachers/teachers.service";
import { audit } from "@/lib/audit/audit";

const schema = z.object({ courseOfferingId: z.string().min(1), newTeacherId: z.string().min(1), reason: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const result = await substituteTeacher({ ...body, assignedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "teacherAssignment.substitute", entityType: "TeacherCourseAssignment", entityId: result.current.id,
      oldValues: { previousAssignmentId: result.previous.id, previousTeacherId: result.previous.teacherId },
      newValues: result.current, ...requestMeta() });
    return ok(result);
  } catch (e) { return fail(e); }
}
