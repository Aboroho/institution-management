export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { cancelChangeRequest } from "@/modules/attendance/attendance.service";
import { audit } from "@/lib/audit/audit";

/**
 * POST /api/v1/attendance/change-requests/{id}/cancel
 *
 * Lets a teacher withdraw THEIR OWN still-pending attendance-entry request.
 * The service is authoritative on all three rules:
 *
 *   - ownership: only `requestedById === auth.userId` may cancel;
 *   - state: only a PENDING request is cancellable (an approved or rejected
 *     one is an admin decision and returns 409);
 *   - preservation: the request row and its per-student proposals are never
 *     deleted, so the audit trail and the approval history stay intact.
 *
 * Cancellation is a conditional update (`WHERE status = 'PENDING'`), so if an
 * admin reviews the same request concurrently the admin's decision wins and
 * this call answers 409 with the reason — the final state always comes from the
 * database, never from what the client last read.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    const body = z
      .object({ note: z.string().trim().max(500).optional() })
      .parse(await req.json().catch(() => ({})));
    const result = await cancelChangeRequest(params.id, { actorUserId: auth.userId, note: body.note });
    await audit({
      actorUserId: auth.userId,
      action: "attendanceChangeRequest.cancel",
      entityType: "AttendanceChangeRequest",
      entityId: params.id,
      oldValues: { status: "PENDING" },
      newValues: result,
      ...requestMeta(),
    });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
