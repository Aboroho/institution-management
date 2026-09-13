export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listEnrollments, createEnrollment } from "@/modules/students/students.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listEnrollments({
      studentId: s.get("studentId") || undefined, academicYearId: s.get("academicYearId") || undefined,
      tradeId: s.get("tradeId") || undefined, semesterId: s.get("semesterId") || undefined,
      shiftId: s.get("shiftId") || undefined, sectionId: s.get("sectionId") || undefined,
      status: s.get("status") || undefined, search: s.get("search") || undefined, page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  studentId: z.string().min(1), academicYearId: z.string().min(1), tradeId: z.string().min(1),
  semesterId: z.string().min(1), shiftId: z.string().min(1), sectionId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createEnrollment(body);
    await audit({ actorUserId: auth.userId, action: "enrollment.create", entityType: "StudentEnrollment", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
