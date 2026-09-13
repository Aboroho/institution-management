export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { recordHistory } from "@/modules/attendance/attendance.service";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role === "STUDENT") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    return ok(await recordHistory(params.id));
  } catch (e) { return fail(e); }
}
