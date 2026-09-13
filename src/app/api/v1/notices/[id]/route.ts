export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { updateNotice } from "@/modules/notices/notices.service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit/audit";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const existing = await prisma.notice.findUnique({ where: { id: params.id } });
    if (!existing) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Notice not found", 404)); }
    if (auth.role === "TEACHER") {
      const t = await prisma.teacher.findUnique({ where: { userId: auth.userId } });
      if (!t || t.id !== existing.teacherId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You can only edit your own notices", 403)); }
    } else if (auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const body = z.object({ title: z.string().min(1).optional(), content: z.string().min(1).optional(), expiresAt: z.coerce.date().nullable().optional() }).parse(await req.json());
    const updated = await updateNotice(params.id, body);
    await audit({ actorUserId: auth.userId, action: "notice.update", entityType: "Notice", entityId: params.id, newValues: body, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
