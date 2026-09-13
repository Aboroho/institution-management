export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { listShifts, createShift } from "@/modules/academic/academic.service";
import { audit } from "@/lib/audit/audit";

export async function GET() {
  try { await requireAuth(); return ok(await listShifts()); }
  catch (e) { return fail(e); }
}

const schema = z.object({ name: z.string().min(1), code: z.string().min(1), startTime: z.string().optional(), endTime: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createShift(body);
    await audit({ actorUserId: auth.userId, action: "shift.create", entityType: "Shift", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
