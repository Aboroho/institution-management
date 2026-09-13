export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { evaluateEligibility } from "@/modules/promotions/promotions.service";

const schema = z.object({
  academicYearId: z.string().min(1), tradeId: z.string().min(1), semesterId: z.string().min(1),
  shiftId: z.string().optional(), sectionId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    return ok(await evaluateEligibility(body));
  } catch (e) { return fail(e); }
}
