export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getSection, updateSection } from "@/modules/academic/academic.service";
import { audit } from "@/lib/audit/audit";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(); return ok(await getSection(params.id)); }
  catch (e) { return fail(e); }
}

const schema = z.object({ name: z.string().min(1).optional(), capacity: z.number().int().positive().nullable().optional(), isActive: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const updated = await updateSection(params.id, body);
    await audit({ actorUserId: auth.userId, action: "section.update", entityType: "Section", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
