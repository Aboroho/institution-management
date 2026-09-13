export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { adminDashboard } from "@/modules/reports/reports.service";

export async function GET() {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    return ok(await adminDashboard());
  } catch (e) { return fail(e); }
}
