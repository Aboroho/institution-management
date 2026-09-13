export const dynamic = "force-dynamic";
// Authorized local-storage file serving (dev fallback when S3 is not configured).
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { storage } from "@/lib/storage/storage";

export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication required", details: null } }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "key is required", details: null } }, { status: 422 });
  const file = await prisma.file.findUnique({ where: { storageKey: key }, include: { submission: { include: { assessment: true } } } });
  if (!file) return NextResponse.json({ error: { code: "NOT_FOUND", message: "File not found", details: null } }, { status: 404 });
  // Authorization: admin, assigned teacher, or owning student.
  let allowed = auth.role === "ADMIN";
  if (!allowed && file.submission) {
    if (auth.role === "STUDENT") {
      const me = await prisma.student.findUnique({ where: { userId: auth.userId } });
      allowed = !!me && me.id === file.submission.studentId;
    } else if (auth.role === "TEACHER") {
      const t = await prisma.teacher.findUnique({ where: { userId: auth.userId } });
      if (t) {
        const a = await prisma.teacherCourseAssignment.findFirst({ where: { courseOfferingId: file.submission.assessment.courseOfferingId, teacherId: t.id, isActive: true } });
        allowed = !!a;
      }
    }
  }
  if (!allowed) return NextResponse.json({ error: { code: "FORBIDDEN", message: "You do not have access to this resource", details: null } }, { status: 403 });
  const buf = await storage.getBuffer(key);
  // Convert Buffer to Uint8Array for NextResponse body
  const body = new Uint8Array(buf);
  return new NextResponse(body, { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${file.originalName}"` } });
}
