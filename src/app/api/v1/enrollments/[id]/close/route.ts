export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { closeEnrollment } from "@/modules/students/students.service";
import { audit } from "@/lib/audit/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = z.object({ status: z.enum(["WITHDRAWN", "TRANSFERRED"]) }).parse(await req.json());
    const updated = await closeEnrollment(params.id, body.status);
    await audit({ actorUserId: auth.userId, action: "enrollment.close", entityType: "StudentEnrollment", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
