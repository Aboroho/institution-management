export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { executePromotion } from "@/modules/promotions/promotions.service";
import { audit } from "@/lib/audit/audit";
import { notify } from "@/lib/notifications/notify";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  items: z.array(z.object({
    enrollmentId: z.string().min(1),
    decision: z.enum(["PROMOTED", "REPEAT", "FAILED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"]),
    reason: z.string().optional(),
  })).min(1),
  toAcademicYearId: z.string().optional(), toSemesterId: z.string().optional(),
  toShiftId: z.string().optional(), toSectionId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const results = await executePromotion({ ...body, decidedById: auth.userId });
    await audit({ actorUserId: auth.userId, action: "promotion.execute", entityType: "StudentPromotion", entityId: `${results.length}-items`, newValues: { count: results.length }, ...requestMeta() });
    // Notify affected students (in-app).
    const students = await prisma.student.findMany({ where: { id: { in: results.map((r: { studentId: string }) => r.studentId) } }, select: { id: true, userId: true } });
    const byId = new Map(results.map((r: { studentId: string }) => [r.studentId, r] as const));
    for (const s of students) {
      const r = byId.get(s.id) as { decision: string; id: string } | undefined;
      await notify({ recipientIds: [s.userId], type: "PROMOTION_RESULT", title: "Promotion result published",
        message: `Your academic result: ${r?.decision}.`, resourceType: "StudentPromotion", resourceId: r?.id });
    }
    return ok({ count: results.length, results });
  } catch (e) { return fail(e); }
}
