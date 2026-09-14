export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireStudentSelf } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { deleteStudent, getStudent, updateStudent } from "@/modules/students/students.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN") await requireStudentSelf(auth, params.id);
    return ok(await getStudent(params.id));
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1).optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(),
  guardianName: z.string().nullable().optional(), guardianPhone: z.string().nullable().optional(),
  gender: z.string().nullable().optional(), dateOfBirth: z.string().nullable().optional(), isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateStudent(params.id, body);
    await audit({ actorUserId: auth.userId, action: "student.update", entityType: "Student", entityId: params.id, newValues: body, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const deleted = await deleteStudent(params.id);
    await audit({
      actorUserId: auth.userId,
      action: "student.delete",
      entityType: "Student",
      entityId: params.id,
      oldValues: deleted,
      ...requestMeta(),
    });
    return ok({ id: deleted.id, deleted: true });
  } catch (e) { return fail(e); }
}
