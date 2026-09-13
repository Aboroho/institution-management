export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth/session";
import { myTeacher } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { teacherDashboard } from "@/modules/reports/reports.service";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (auth.role !== "TEACHER" && auth.role !== "ADMIN") { const { AppError } = await import("@/lib/errors/errors"); return fail(new AppError("FORBIDDEN", "You do not have access to this resource", 403)); }
    const t = auth.role === "TEACHER" ? await myTeacher(auth) : null;
    if (!t) return ok({ assignments: [], todayClasses: 0 });
    return ok(await teacherDashboard(t.id));
  } catch (e) { return fail(e); }
}
