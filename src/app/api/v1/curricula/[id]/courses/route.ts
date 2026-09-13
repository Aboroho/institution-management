export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { addCurriculumCourse, removeCurriculumCourse } from "@/modules/courses/courses.service";
import { audit } from "@/lib/audit/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = z.object({ courseId: z.string().min(1) }).parse(await req.json());
    const created = await addCurriculumCourse(params.id, body.courseId);
    await audit({ actorUserId: auth.userId, action: "curriculum.addCourse", entityType: "Curriculum", entityId: params.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const courseId = req.nextUrl.searchParams.get("courseId");
    if (!courseId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "courseId is required", 422)); }
    await removeCurriculumCourse(params.id, courseId);
    await audit({ actorUserId: auth.userId, action: "curriculum.removeCourse", entityType: "Curriculum", entityId: params.id, newValues: { courseId }, ...requestMeta() });
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
