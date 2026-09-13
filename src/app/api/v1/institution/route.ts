export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { getInstitution, updateInstitution } from "@/modules/academic/academic.service";
import { audit } from "@/lib/audit/audit";

export async function GET() {
  try { await requireAuth(); return ok(await getInstitution()); }
  catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1).optional(), logoUrl: z.string().nullable().optional(),
  address: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(), website: z.string().nullable().optional(),
  semesterCount: z.number().int().min(1).max(20).optional(), shiftCount: z.number().int().min(1).max(10).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const before = await getInstitution();
    const updated = await updateInstitution(body);
    const meta = requestMeta();
    await audit({ actorUserId: auth.userId, action: "institution.update", entityType: "Institution", entityId: updated.id, oldValues: before, newValues: updated, ...meta });
    return ok(updated);
  } catch (e) { return fail(e); }
}
