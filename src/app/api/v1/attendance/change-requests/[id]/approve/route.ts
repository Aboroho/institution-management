export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { reviewChangeRequest } from "@/modules/attendance/attendance.service";
import { audit } from "@/lib/audit/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = z.object({ reviewNote: z.string().optional() }).parse(await req.json().catch(() => ({})));
    const updated = await reviewChangeRequest(params.id, { approve: true, reviewedById: auth.userId, reviewNote: body.reviewNote });
    await audit({ actorUserId: auth.userId, action: "attendanceChangeRequest.approve", entityType: "AttendanceChangeRequest", entityId: params.id, newValues: updated, ...requestMeta() });
    return ok(updated);
  } catch (e) { return fail(e); }
}
