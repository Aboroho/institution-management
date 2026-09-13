export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { studentFullReport } from "@/modules/reports/reports.service";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const report = await studentFullReport(params.id);
    if (!report) { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("NOT_FOUND", "Student not found", 404)); }
    return ok(report);
  } catch (e) { return fail(e); }
}
