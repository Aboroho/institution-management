export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { updateAcademicYear } from "@/modules/academic/academic.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAuth();
    const item = await prisma.academicYear.findUnique({ where: { id: params.id } });
    if (!item) return fail(new (await import("@/lib/errors/errors")).AppError("NOT_FOUND", "Academic year not found", 404));
    return ok(item);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1).optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(), isArchived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const before = await prisma.academicYear.findUnique({ where: { id: params.id } });
    const updated = await updateAcademicYear(params.id, body);
    await audit({ actorUserId: auth.userId, action: "academicYear.update", entityType: "AcademicYear", entityId: params.id, oldValues: before, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
