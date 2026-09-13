import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule, approvalRequired } from "@/lib/errors/errors";
import type { AttendanceStatus } from "@prisma/client";

export const TEACHER_EDIT_WINDOW_DAYS = 7;
export const TEACHER_DIRECT_CORRECTIONS = 2;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysOld(date: Date) {
  const ms = startOfDay(new Date()).getTime() - startOfDay(date).getTime();
  return Math.floor(ms / 86400000);
}

/** Upsert a session for a date (exactly one session per offering per date). */
export async function saveSessionAttendance(opts: {
  courseOfferingId: string; attendanceDate: Date; records: { studentId: string; status: AttendanceStatus; note?: string }[];
  actorUserId: string; isAdmin: boolean; reason?: string;
}) {
  const offering = await prisma.courseOffering.findUnique({ where: { id: opts.courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  const date = startOfDay(opts.attendanceDate);

  return prisma.$transaction(async (tx) => {
    let session = await tx.attendanceSession.findUnique({
      where: { courseOfferingId_attendanceDate: { courseOfferingId: opts.courseOfferingId, attendanceDate: date } },
    });
    const isNewSession = !session;
    if (!session) {
      // Missing historical session may be created even outside the edit window.
      session = await tx.attendanceSession.create({
        data: { courseOfferingId: opts.courseOfferingId, attendanceDate: date, createdById: opts.actorUserId },
      });
    } else if (!opts.isAdmin && daysOld(session.attendanceDate) > TEACHER_EDIT_WINDOW_DAYS) {
      throw businessRule(`Attendance older than ${TEACHER_EDIT_WINDOW_DAYS} days cannot be edited by teachers`);
    }

    for (const r of opts.records) {
      const existing = await tx.attendanceRecord.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: r.studentId } },
      });
      if (!existing) {
        const rec = await tx.attendanceRecord.create({
          data: { sessionId: session.id, studentId: r.studentId, status: r.status, note: r.note },
        });
        await tx.attendanceChangeLog.create({
          data: { recordId: rec.id, oldStatus: null, newStatus: r.status, changedById: opts.actorUserId, reason: "Initial entry" },
        });
      } else if (existing.status !== r.status || (r.note !== undefined && r.note !== existing.note)) {
        // Modification path with limits for teachers.
        if (!opts.isAdmin) {
          if (existing.directCorrections >= TEACHER_DIRECT_CORRECTIONS) {
            throw approvalRequired("Admin approval required", { recordId: existing.id });
          }
          if (!opts.reason) throw businessRule("Reason is required for attendance correction");
        }
        await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            status: r.status, note: r.note ?? existing.note,
            directCorrections: opts.isAdmin ? existing.directCorrections : existing.directCorrections + 1,
          },
        });
        await tx.attendanceChangeLog.create({
          data: {
            recordId: existing.id, oldStatus: existing.status, newStatus: r.status,
            changedById: opts.actorUserId, reason: opts.reason ?? (opts.isAdmin ? "Admin correction" : "Correction"),
          },
        });
      }
    }
    return { sessionId: session.id, isNewSession };
  });
}

export async function getSession(courseOfferingId: string, date: Date) {
  const d = startOfDay(date);
  const session = await prisma.attendanceSession.findUnique({
    where: { courseOfferingId_attendanceDate: { courseOfferingId, attendanceDate: d } },
    include: {
      records: {
        include: { student: { include: { user: { select: { name: true, email: true } } } } },
        orderBy: { student: { studentId: "asc" } },
      },
    },
  });
  return session;
}

export async function listSessions(courseOfferingId: string, opts: { from?: Date; to?: Date }) {
  const where: Record<string, unknown> = { courseOfferingId };
  if (opts.from || opts.to) {
    where.attendanceDate = {
      ...(opts.from ? { gte: startOfDay(opts.from) } : {}),
      ...(opts.to ? { lte: startOfDay(opts.to) } : {}),
    };
  }
  return prisma.attendanceSession.findMany({
    where, orderBy: { attendanceDate: "desc" },
    include: { records: true },
  });
}

export async function recordHistory(recordId: string) {
  const rec = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    include: {
      changeLogs: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true, email: true } } } },
      changeRequests: { orderBy: { createdAt: "desc" } },
      session: true,
      student: { include: { user: { select: { name: true } } } },
    },
  });
  if (!rec) throw notFound("Attendance record not found");
  return rec;
}

// ---- Change requests (approval workflow)
export async function createChangeRequest(data: {
  recordId: string; newStatus: AttendanceStatus; reason: string; requestedById: string;
}) {
  const rec = await prisma.attendanceRecord.findUnique({ where: { id: data.recordId }, include: { session: true } });
  if (!rec) throw notFound("Attendance record not found");
  if (!data.reason?.trim()) throw businessRule("Reason is required");
  if (rec.status === data.newStatus) throw businessRule("New status is the same as current status");
  const pending = await prisma.attendanceChangeRequest.findFirst({ where: { recordId: data.recordId, status: "PENDING" } });
  if (pending) throw conflict("A pending request already exists for this record");
  return prisma.attendanceChangeRequest.create({
    data: { recordId: data.recordId, oldStatus: rec.status, newStatus: data.newStatus, reason: data.reason, requestedById: data.requestedById },
  });
}

export async function listChangeRequests(opts: { status?: string; courseOfferingId?: string; page: number; limit: number }) {
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  if (opts.courseOfferingId) where.record = { session: { courseOfferingId: opts.courseOfferingId } };
  const [total, items] = await prisma.$transaction([
    prisma.attendanceChangeRequest.count({ where }),
    prisma.attendanceChangeRequest.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: {
        record: {
          include: {
            student: { include: { user: { select: { name: true } } } },
            session: { include: { courseOffering: { include: { course: true, section: true } } } },
          },
        },
        requestedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
    }),
  ]);
  return { items, total };
}

export async function reviewChangeRequest(id: string, opts: { approve: boolean; reviewedById: string; reviewNote?: string }) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.attendanceChangeRequest.findUnique({ where: { id } });
    if (!req) throw notFound("Change request not found");
    if (req.status !== "PENDING") throw businessRule("Request already reviewed");
    const rec = await tx.attendanceRecord.findUnique({ where: { id: req.recordId } });
    if (!rec) throw notFound("Attendance record not found");
    if (opts.approve) {
      if (rec.status !== req.oldStatus) throw conflict("Record changed since request was created");
      await tx.attendanceRecord.update({ where: { id: rec.id }, data: { status: req.newStatus } });
      await tx.attendanceChangeLog.create({
        data: { recordId: rec.id, oldStatus: req.oldStatus, newStatus: req.newStatus, changedById: opts.reviewedById, reason: `Approved: ${req.reason}` },
      });
    }
    return tx.attendanceChangeRequest.update({
      where: { id },
      data: {
        status: opts.approve ? "APPROVED" : "REJECTED",
        reviewedById: opts.reviewedById, reviewedAt: new Date(), reviewNote: opts.reviewNote,
      },
    });
  });
}

export async function studentAttendanceSummary(studentId: string, courseOfferingId?: string) {
  const where: Record<string, unknown> = { studentId };
  if (courseOfferingId) where.session = { courseOfferingId };
  const records = await prisma.attendanceRecord.findMany({
    where, include: { session: { select: { courseOfferingId: true, attendanceDate: true } } },
  });
  const byOffering = new Map<string, { total: number; present: number; absent: number; late: number; excused: number }>();
  for (const r of records) {
    const key = r.session.courseOfferingId;
    if (!byOffering.has(key)) byOffering.set(key, { total: 0, present: 0, absent: 0, late: 0, excused: 0 });
    const s = byOffering.get(key)!;
    s.total += 1;
    if (r.status === "PRESENT") s.present += 1;
    else if (r.status === "ABSENT") s.absent += 1;
    else if (r.status === "LATE") s.late += 1;
    else s.excused += 1;
  }
  const offerings = await prisma.courseOffering.findMany({
    where: { id: { in: [...byOffering.keys()] } },
    include: { course: true, section: true },
  });
  return offerings.map((o) => {
    const s = byOffering.get(o.id)!;
    const pct = s.total ? Math.round(((s.present + s.late * 0.5 + s.excused * 0.5) / s.total) * 1000) / 10 : 0;
    return { offering: o, ...s, percentage: pct };
  });
}
