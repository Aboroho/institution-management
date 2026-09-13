export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, myTeacher } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listOfferings, createOffering } from "@/modules/course-offerings/offerings.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    let teacherId = s.get("teacherId") || undefined;
    // Teachers only see their own offerings unless admin explicitly filters.
    if (auth.role === "TEACHER") {
      const t = await myTeacher(auth);
      teacherId = t.id;
    }
    const isActive = s.get("isActive");
    const { items, total } = await listOfferings({
      academicYearId: s.get("academicYearId") || undefined, tradeId: s.get("tradeId") || undefined,
      semesterId: s.get("semesterId") || undefined, shiftId: s.get("shiftId") || undefined,
      sectionId: s.get("sectionId") || undefined, courseId: s.get("courseId") || undefined,
      teacherId, isActive: isActive === null ? undefined : isActive === "true",
      search: s.get("search") || undefined, page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  academicYearId: z.string().min(1), tradeId: z.string().min(1), semesterId: z.string().min(1),
  shiftId: z.string().min(1), sectionId: z.string().min(1), courseId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createOffering(body);
    await audit({ actorUserId: auth.userId, action: "offering.create", entityType: "CourseOffering", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
