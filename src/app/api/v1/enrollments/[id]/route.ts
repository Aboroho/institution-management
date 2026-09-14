export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors/errors";
import { updateEnrollmentRollNumber } from "@/modules/students/students.service";
import { rollNumber as rollNumberField } from "@/lib/validation/common";
import { audit } from "@/lib/audit/audit";

const schema = z.object({ rollNumber: rollNumberField });

/** Corrects a mistyped roll number. Academic placement (context, status, dates) is immutable here. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const before = await prisma.studentEnrollment.findUnique({ where: { id: params.id } });
    if (!before) throw notFound("Enrollment not found");
    const updated = await updateEnrollmentRollNumber(params.id, body.rollNumber);
    if (updated.rollNumber !== before.rollNumber) {
      await audit({
        actorUserId: auth.userId, action: "enrollment.roll_number.update", entityType: "StudentEnrollment",
        entityId: updated.id, oldValues: { rollNumber: before.rollNumber }, newValues: { rollNumber: updated.rollNumber },
        ...requestMeta(),
      });
    }
    return ok(updated);
  } catch (e) { return fail(e); }
}
