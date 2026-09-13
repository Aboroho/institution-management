export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth/session";
import { myStudent } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { studentDashboard } from "@/modules/reports/reports.service";

export async function GET() {
  try {
    const auth = await requireAuth();
    const me = await myStudent(auth);
    return ok(await studentDashboard(me.id));
  } catch (e) { return fail(e); }
}
