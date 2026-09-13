export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getCourse, updateCourse } from "@/modules/courses/courses.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(); return ok(await getCourse(params.id)); }
  catch (e) { return fail(e); }
}

const schema = z.object({
  code: z.string().min(1).optional(), title: z.string().min(1).optional(),
  description: z.string().nullable().optional(), credits: z.number().nullable().optional(), isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateCourse(params.id, body);
    await audit({ actorUserId: auth.userId, action: "course.update", entityType: "Course", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
