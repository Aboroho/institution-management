export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listTeachers, createTeacher } from "@/modules/teachers/teachers.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const isActive = s.get("isActive");
    const { items, total } = await listTeachers({ search: s.get("search") || undefined, isActive: isActive === null ? undefined : isActive === "true", page, limit });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1), email: z.string().email(), password: z.string().min(8), employeeId: z.string().min(1),
  department: z.string().optional(), designation: z.string().optional(), phone: z.string().optional(), address: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createTeacher(body);
    await audit({ actorUserId: auth.userId, action: "teacher.create", entityType: "Teacher", entityId: created.id, newValues: { employeeId: created.employeeId }, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
