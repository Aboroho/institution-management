export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireActiveTeacherAssignment } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { createMarkChangeRequest, listMarkChangeRequests } from "@/modules/marks/marks.service";
import { prisma } from "@/lib/db/prisma";
import { notifyAdmins } from "@/lib/notifications/notify";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listMarkChangeRequests({ status: s.get("status") || undefined, page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({ markId: z.string().min(1), newMarks: z.number().min(0), reason: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = schema.parse(await req.json());
    const mark = await prisma.assessmentMark.findUnique({ where: { id: body.markId }, include: { assessment: true } });
    if (!mark) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Mark not found", 404)); }
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, mark.assessment.courseOfferingId);
    else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const created = await createMarkChangeRequest({ ...body, requestedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "markChangeRequest.create", entityType: "AssessmentMarkChangeRequest", entityId: created.id, newValues: created, ...requestMeta() });
    await notifyAdmins({
      type: "PENDING_APPROVAL",
      title: "Mark change awaiting approval",
      message: "A teacher submitted a mark correction that requires admin approval.",
      resourceType: "AssessmentMarkChangeRequest",
      resourceId: created.id,
    });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
