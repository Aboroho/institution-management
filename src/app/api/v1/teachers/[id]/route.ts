export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getTeacher, updateTeacher } from "@/modules/teachers/teachers.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    return ok(await getTeacher(params.id));
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1).optional(), department: z.string().nullable().optional(),
  designation: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(), isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateTeacher(params.id, body);
    await audit({ actorUserId: auth.userId, action: "teacher.update", entityType: "Teacher", entityId: params.id, newValues: body, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
