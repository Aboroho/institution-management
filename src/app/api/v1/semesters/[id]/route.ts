export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { updateSemester } from "@/modules/academic/academic.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAuth();
    const item = await prisma.semester.findUnique({ where: { id: params.id }, include: { trade: true } });
    if (!item) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Semester not found", 404)); }
    return ok(item);
  } catch (e) { return fail(e); }
}

const schema = z.object({ number: z.number().int().min(1).optional(), name: z.string().min(1).optional(), isActive: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateSemester(params.id, body);
    await audit({ actorUserId: auth.userId, action: "semester.update", entityType: "Semester", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
