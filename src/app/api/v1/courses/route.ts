export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listCourses, createCourse } from "@/modules/courses/courses.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const isActive = s.get("isActive");
    const { items, total } = await listCourses({ search: s.get("search") || undefined, isActive: isActive === null ? undefined : isActive === "true", page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({ code: z.string().min(1), title: z.string().min(1), description: z.string().optional(), credits: z.number().positive().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createCourse(body);
    await audit({ actorUserId: auth.userId, action: "course.create", entityType: "Course", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
