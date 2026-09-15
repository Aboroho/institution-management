export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listStudents, createStudent } from "@/modules/students/students.service";
import { audit } from "@/lib/audit/audit";
import { rollNumber as rollNumberField } from "@/lib/validation/common";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listStudents({
      search: s.get("search") || undefined, academicYearId: s.get("academicYearId") || undefined,
      tradeId: s.get("tradeId") || undefined, semesterId: s.get("semesterId") || undefined,
      shiftId: s.get("shiftId") || undefined, sectionId: s.get("sectionId") || undefined,
      status: s.get("status") || undefined, page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  name: z.string().min(1), email: z.string().email(), password: z.string().min(8), studentId: z.string().min(1),
  dateOfBirth: z.string().optional(), gender: z.string().optional(), phone: z.string().optional(),
  address: z.string().optional(), guardianName: z.string().optional(), guardianPhone: z.string().optional(),
  // Enrollment context — required so a student never exists without a roll number.
  academicYearId: z.string().min(1, "Academic year is required"),
  tradeId: z.string().min(1, "Trade is required"),
  semesterId: z.string().min(1, "Semester is required"),
  shiftId: z.string().min(1, "Shift is required"),
  sectionId: z.string().min(1, "Section is required"),
  rollNumber: rollNumberField,
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createStudent(body);
    await audit({ actorUserId: auth.userId, action: "student.create", entityType: "Student", entityId: created.id, newValues: { studentId: created.studentId, rollNumber: (created as any).enrollment?.rollNumber }, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
