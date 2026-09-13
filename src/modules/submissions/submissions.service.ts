import { prisma } from "@/lib/db/prisma";
import { notFound, businessRule, forbidden } from "@/lib/errors/errors";
import { storage, SUBMISSION_MAX_BYTES } from "@/lib/storage/storage";
import { randomUUID } from "crypto";

export async function submitPdf(opts: {
  assessmentId: string; studentId: string; uploaderUserId: string;
  buffer: Buffer; originalName: string; mimeType: string; size: number;
}) {
  const assessment = await prisma.assessment.findUnique({ where: { id: opts.assessmentId }, include: { courseOffering: true } });
  if (!assessment) throw notFound("Assessment not found");
  if (!assessment.submitable) throw businessRule("This assessment does not accept submissions");
  // Backend validation: MIME, extension, size.
  const lower = opts.originalName.toLowerCase();
  if (!lower.endsWith(".pdf")) throw businessRule("Only PDF files are allowed");
  if (opts.mimeType !== "application/pdf") throw businessRule("Only PDF files are allowed (invalid MIME type)");
  if (opts.size > SUBMISSION_MAX_BYTES) throw businessRule("File exceeds 50 MB limit");
  if (opts.buffer.subarray(0, 5).toString() !== "%PDF-") throw businessRule("File is not a valid PDF");
  // Verify enrollment membership.
  const o = assessment.courseOffering;
  const en = await prisma.studentEnrollment.findFirst({
    where: {
      studentId: opts.studentId, academicYearId: o.academicYearId, tradeId: o.tradeId,
      semesterId: o.semesterId, shiftId: o.shiftId, sectionId: o.sectionId, status: "ACTIVE",
    },
  });
  if (!en) throw forbidden("You are not enrolled in this course offering");

  const key = `submissions/${assessment.id}/${opts.studentId}/${randomUUID()}.pdf`;
  const { bucket } = await storage.put(opts.buffer, { key, contentType: "application/pdf" });
  const isLate = assessment.dueDate ? new Date() > assessment.dueDate : false;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.assessmentSubmission.findUnique({
      where: { assessmentId_studentId: { assessmentId: opts.assessmentId, studentId: opts.studentId } },
      include: { file: true },
    });
    const file = await tx.file.create({
      data: {
        originalName: opts.originalName, mimeType: "application/pdf", size: opts.size,
        storageKey: key, bucket, uploadedById: opts.uploaderUserId,
      },
    });
    if (!existing) {
      return tx.assessmentSubmission.create({
        data: { assessmentId: opts.assessmentId, studentId: opts.studentId, fileId: file.id, isLate },
        include: { file: true },
      });
    }
    // Replace file (resubmission); remove old file metadata.
    const updated = await tx.assessmentSubmission.update({
      where: { id: existing.id },
      data: { fileId: file.id, submittedAt: new Date(), isLate },
      include: { file: true },
    });
    if (existing.file) {
      await tx.file.delete({ where: { id: existing.file.id } });
      await storage.remove(existing.file.storageKey).catch(() => undefined);
    }
    return updated;
  });
}

export async function listSubmissions(assessmentId: string) {
  return prisma.assessmentSubmission.findMany({
    where: { assessmentId },
    orderBy: { submittedAt: "desc" },
    include: { student: { include: { user: { select: { name: true } } } }, file: true },
  });
}

export async function getDownloadUrl(submissionId: string) {
  const s = await prisma.assessmentSubmission.findUnique({ where: { id: submissionId }, include: { file: true } });
  if (!s?.file) throw notFound("Submission file not found");
  const url = await storage.getSignedDownloadUrl(s.file.storageKey);
  return { url, fileName: s.file.originalName, mimeType: s.file.mimeType };
}
