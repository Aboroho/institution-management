export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { updateShift } from "@/modules/academic/academic.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAuth();
    const item = await prisma.shift.findUnique({ where: { id: params.id } });
    if (!item) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Shift not found", 404)); }
    return ok(item);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1).optional(), code: z.string().min(1).optional(),
  startTime: z.string().nullable().optional(), endTime: z.string().nullable().optional(), isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateShift(params.id, body);
    await audit({ actorUserId: auth.userId, action: "shift.update", entityType: "Shift", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
