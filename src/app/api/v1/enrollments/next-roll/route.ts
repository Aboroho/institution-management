export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { nextAvailableRollNumber } from "@/modules/students/students.service";

const query = z.object({ sectionId: z.string().min(1, "Section is required") });

/**
 * Suggests the next roll number for a section so the enrollment form can prefill it.
 * The administrator can still enter a different number — uniqueness stays enforced on save.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const { sectionId } = query.parse({
      sectionId: req.nextUrl.searchParams.get("sectionId") ?? undefined,
    });
    const rollNumber = await nextAvailableRollNumber(sectionId);
    return ok({ sectionId, rollNumber });
  } catch (e) { return fail(e); }
}
