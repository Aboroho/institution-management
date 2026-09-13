export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin, requireActiveTeacherAssignment, requireStudentInOffering } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getOffering, updateOffering } from "@/modules/course-offerings/offerings.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role === "TEACHER") await requireActiveTeacherAssignment(auth, params.id);
    else if (auth.role === "STUDENT") await requireStudentInOffering(auth, params.id);
    return ok(await getOffering(params.id));
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = z.object({ isActive: z.boolean() }).parse(await req.json());
    const updated = await updateOffering(params.id, body);
    await audit({ actorUserId: auth.userId, action: "offering.update", entityType: "CourseOffering", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
