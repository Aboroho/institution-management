export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { markHistory } from "@/modules/marks/marks.service";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role === "STUDENT") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const markId = req.nextUrl.searchParams.get("markId");
    if (!markId) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("VALIDATION_ERROR", "markId is required", 422)); }
    return ok(await markHistory(markId));
  } catch (e) { return fail(e); }
}
