export const dynamic = "force-dynamic";
import { getAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
export async function GET() {
  try {
    const auth = await getAuth();
    if (!auth) return fail(new (await import("@/lib/errors/errors")).AppError("UNAUTHORIZED", "Authentication required", 401));
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, name: true, role: true, isSeedAdmin: true, student: { select: { id: true, studentId: true } }, teacher: { select: { id: true, employeeId: true } } },
    });
    return ok(user);
  } catch (e) { return fail(e); }
}
