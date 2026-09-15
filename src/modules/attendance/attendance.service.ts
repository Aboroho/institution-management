import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule, forbidden } from "@/lib/errors/errors";
import { Prisma, type AttendanceStatus, type ChangeRequestStatus } from "@prisma/client";
import {
  TEACHER_EDIT_WINDOW_DAYS,
  TEACHER_DIRECT_CORRECTIONS,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
  type AttendanceSessionSummary,
  type AttendanceReportItem,
  type AttendanceHistoryPayload,
} from "./attendance.types";

export {
  TEACHER_EDIT_WINDOW_DAYS,
  TEACHER_DIRECT_CORRECTIONS,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
} from "./attendance.types";
export type { AttendanceSessionSummary, AttendanceReportItem, AttendanceHistoryPayload } from "./attendance.types";

/**
 * Midnight UTC of the given date. Attendance dates are timezone-agnostic
 * calendar days (stored as Postgres DATE via Prisma, which round-trips them as
 * UTC-midnight Dates), so all day arithmetic MUST use UTC getters. Using the
 * server-local timezone here shifted sessions by a day on non-UTC hosts.
 */
export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function daysOld(date: Date) {
  const ms = startOfDay(new Date()).getTime() - startOfDay(date).getTime();
  return Math.floor(ms / 86400000);
}

export function dateOnlyISO(d: Date): string {
  // Returns yyyy-mm-dd without timezone drift.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type AttendanceSaveSkipped = {
  recordId: string;
  studentId: string;
  currentStatus: AttendanceStatus;
  reason: "APPROVAL_REQUIRED";
};

export type AttendanceSaveResult = {
  sessionId: string;
  isNewSession: boolean;
  createdCount: number;
  updatedCount: number;
  skipped: AttendanceSaveSkipped[];
};

/**
 * The academic context of a course offering, used to resolve the enrollment
 * rows (roll numbers) that belong to it. StudentEnrollment carries all five
 * academic foreign keys, so every lookup that scopes students must use the
 * full context — filtering by `sectionId` alone would also match enrollments
 * of the same section name in another academic year/trade/semester/shift.
 */
export const attendanceOfferingContextSelect = {
  id: true,
  academicYearId: true,
  tradeId: true,
  semesterId: true,
  shiftId: true,
  sectionId: true,
  course: { select: { title: true, code: true } },
  section: { select: { name: true } },
  semester: { select: { name: true } },
  trade: { select: { name: true, code: true } },
  shift: { select: { name: true } },
  academicYear: { select: { name: true } },
} satisfies Prisma.CourseOfferingSelect;

/**
 * Upsert a session for a date (exactly one session per offering per date).
 *
 * TEACHER-ONLY operation. Admins must never take or directly edit attendance
 * (they approve change requests instead) — the API route enforces this, and
 * the service rejects admin writes defensively as a second layer.
 *
 * A teacher record that exhausted its direct corrections is SKIPPED and
 * reported back (so the teacher can file a change request for it) instead of
 * aborting the whole save — previously one at-limit record discarded every
 * other valid correction in the same edit.
 *
 * NOTE (product decision 2026-09-15, overrides README §10 "Admin: may edit
 * indefinitely"): admins are READ-ONLY for attendance. They inspect sessions,
 * view history, and approve/reject teacher change requests, but they cannot
 * save attendance directly. The API layer rejects admin saves with 403 and the
 * guard below rejects them a second time, so no admin save path exists.
 */
export async function saveSessionAttendance(opts: {
  courseOfferingId: string; attendanceDate: Date; records: { studentId: string; status: AttendanceStatus; note?: string }[];
  actorUserId: string; isAdmin: boolean; reason?: string;
}): Promise<AttendanceSaveResult> {
  if (opts.isAdmin) {
    throw forbidden("Admins cannot take or edit attendance directly. Review change requests instead.");
  }
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
    } else if (daysOld(session.attendanceDate) > TEACHER_EDIT_WINDOW_DAYS) {
      throw businessRule(`Attendance older than ${TEACHER_EDIT_WINDOW_DAYS} days cannot be edited by teachers`);
    }

    let createdCount = 0;
    let updatedCount = 0;
    const skipped: AttendanceSaveSkipped[] = [];

    for (const r of opts.records) {
      const existing = await tx.attendanceRecord.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: r.studentId } },
      });
      if (!existing) {
        const rec = await tx.attendanceRecord.create({
          data: { sessionId: session.id, studentId: r.studentId, status: r.status, note: r.note },
        });
        await tx.attendanceChangeLog.create({
          data: {
            recordId: rec.id,
            oldStatus: null,
            newStatus: r.status,
            changedById: opts.actorUserId,
            reason: isNewSession ? "Initial entry" : `Added to existing session${opts.reason ? `: ${opts.reason}` : ""}`,
          },
        });
        createdCount += 1;
      } else if (existing.status !== r.status || (r.note !== undefined && r.note !== existing.note)) {
        // Modification path with limits for teachers.
        if (!opts.reason) throw businessRule("Reason is required for attendance correction");
        if (existing.directCorrections >= TEACHER_DIRECT_CORRECTIONS) {
          skipped.push({
            recordId: existing.id,
            studentId: r.studentId,
            currentStatus: existing.status,
            reason: "APPROVAL_REQUIRED",
          });
          continue;
        }
        await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            status: r.status, note: r.note ?? existing.note,
            directCorrections: existing.directCorrections + 1,
          },
        });
        await tx.attendanceChangeLog.create({
          data: {
            recordId: existing.id,
            oldStatus: existing.status,
            newStatus: r.status,
            changedById: opts.actorUserId,
            reason: opts.reason ?? "Correction",
          },
        });
        updatedCount += 1;
      }
    }

    // One edit operation that changed an EXISTING session counts as exactly one
    // update, no matter how many student records it touched. Creating the
    // session (initial entry) is not an update.
    if (!isNewSession && (createdCount > 0 || updatedCount > 0)) {
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: { updateCount: { increment: 1 } },
      });
    }

    return { sessionId: session.id, isNewSession, createdCount, updatedCount, skipped };
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
  const where: Prisma.AttendanceSessionWhereInput = { courseOfferingId };
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

/**
 * Dedicated Attendance Report listing.
 *
 * Server-side pagination + date filtering. Summaries are aggregated in the DB
 * (groupBy on AttendanceRecord) so we never load every record for a course.
 * Update count is the stored per-session edit counter (incremented once per
 * save/approval that changed the session, initial creation excluded).
 */
export async function listAttendanceReport(opts: {
  courseOfferingId: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sort?: "attendanceDate";
  order?: "asc" | "desc";
}): Promise<{ items: AttendanceReportItem[]; total: number; page: number; pageSize: number }> {
  const courseOfferingId = opts.courseOfferingId;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const requestedSize = Math.floor(opts.pageSize ?? DEFAULT_ATTENDANCE_PAGE_SIZE);
  const pageSize = Math.min(MAX_ATTENDANCE_PAGE_SIZE, Math.max(1, requestedSize));
  const order = opts.order === "asc" ? "asc" : "desc";
  // Sessions are always ordered by attendance date; the parameter is kept so
  // the API contract (and future sort keys) stay explicit.
  const sort: "attendanceDate" = opts.sort ?? "attendanceDate";

  const sessionWhere: Prisma.AttendanceSessionWhereInput = { courseOfferingId };
  const dateFilter: Prisma.DateTimeFilter = {};
  if (opts.from) dateFilter.gte = startOfDay(opts.from);
  if (opts.to) dateFilter.lte = startOfDay(opts.to);
  if (dateFilter.gte || dateFilter.lte) sessionWhere.attendanceDate = dateFilter;

  const [total, sessions] = await prisma.$transaction([
    prisma.attendanceSession.count({ where: sessionWhere }),
    prisma.attendanceSession.findMany({
      where: sessionWhere,
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, courseOfferingId: true, attendanceDate: true, createdById: true, createdAt: true, updatedAt: true, updateCount: true },
    }),
  ]);

  if (sessions.length === 0) {
    return { items: [], total, page, pageSize };
  }

  const sessionIds = sessions.map((s) => s.id);

  // Aggregate summary counts by status per session in a single query.
  const grouped = await prisma.attendanceRecord.groupBy({
    by: ["sessionId", "status"],
    where: { sessionId: { in: sessionIds } },
    _count: { _all: true },
  });

  const summaries = new Map<string, AttendanceSessionSummary>();
  for (const g of grouped) {
    let s = summaries.get(g.sessionId);
    if (!s) {
      s = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
      summaries.set(g.sessionId, s);
    }
    const c = g._count._all;
    s.total += c;
    if (g.status === "PRESENT") s.present = c;
    else if (g.status === "ABSENT") s.absent = c;
    else if (g.status === "LATE") s.late = c;
    else if (g.status === "EXCUSED") s.excused = c;
  }

  const items: AttendanceReportItem[] = sessions.map((s) => ({
    id: s.id,
    courseOfferingId: s.courseOfferingId,
    attendanceDate: dateOnlyISO(s.attendanceDate),
    createdById: s.createdById,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    summary: summaries.get(s.id) ?? { total: 0, present: 0, absent: 0, late: 0, excused: 0 },
    updateCount: s.updateCount,
  }));

  return { items, total, page, pageSize };
}

/** Session-scoped change history: every student-level change tied to a session. */
export async function getSessionHistory(sessionId: string): Promise<AttendanceHistoryPayload> {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      // The full offering context is required: the foreign-key scalars scope the
      // enrollment (roll number) lookup below, and the relations label the UI.
      courseOffering: { select: attendanceOfferingContextSelect },
    },
  });
  if (!session) throw notFound("Attendance session not found");

  const offering = session.courseOffering;

  const records = await prisma.attendanceRecord.findMany({
    where: { sessionId },
    select: {
      id: true,
      status: true,
      directCorrections: true,
      student: {
        select: {
          id: true,
          studentId: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: { student: { studentId: "asc" } },
  });

  const recordIds = records.map((r) => r.id);

  // Pull logs and change requests (any status) in parallel.
  const [logs, relatedRequests] = await Promise.all([
    prisma.attendanceChangeLog.findMany({
      where: { recordId: { in: recordIds } },
      orderBy: { createdAt: "desc" },
      include: {
        changedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.attendanceChangeRequest.findMany({
      where: { recordId: { in: recordIds } },
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        reviewedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  // Annotate each change-log row with a changeType and whether it was approval-based.
  const requestByRecordOldNew = new Map<string, (typeof relatedRequests)[number]>();
  for (const r of relatedRequests) {
    // Most-recent request for that recordId + (oldStatus,newStatus) tuple.
    const key = `${r.recordId}:${r.oldStatus}->${r.newStatus}`;
    if (!requestByRecordOldNew.has(key)) requestByRecordOldNew.set(key, r);
  }

  const annotated = logs.map((l) => {
    const key = `${l.recordId}:${l.oldStatus}->${l.newStatus}`;
    const req = requestByRecordOldNew.get(key);
    // A change was "approval-based" if a corresponding change-request exists
    // (regardless of its final status) — admin approvals and rejections both
    // originate from a request.
    return {
      id: l.id,
      recordId: l.recordId,
      oldStatus: l.oldStatus,
      newStatus: l.newStatus,
      reason: l.reason,
      timestamp: l.createdAt.toISOString(),
      changedBy: {
        id: l.changedBy.id,
        name: l.changedBy.name,
        email: l.changedBy.email,
        role: l.changedBy.role,
      },
      changeType: l.oldStatus == null ? ("INITIAL_ENTRY" as const) : ("CORRECTION" as const),
      viaApproval: Boolean(req),
      relatedChangeRequest: req
        ? {
            id: req.id,
            status: req.status,
            requestedBy: { id: req.requestedBy.id, name: req.requestedBy.name, role: req.requestedBy.role },
            reviewedBy: req.reviewedBy
              ? { id: req.reviewedBy.id, name: req.reviewedBy.name, role: req.reviewedBy.role }
              : null,
            reviewedAt: req.reviewedAt?.toISOString() ?? null,
            reviewNote: req.reviewNote ?? null,
          }
        : null,
    };
  });

  // Roll numbers live on the enrollment (unique per section), not on the
  // student — resolve them so history rows can show roll order.
  //
  // SECURITY/CORRECTNESS: the enrollment must be scoped by the FULL academic
  // context of the offering (all five foreign keys), never by `sectionId`
  // alone. Section names repeat across academic years/trades/semesters/shifts,
  // so a sectionId-only filter could pick up a roll number from an unrelated
  // enrollment of a different context.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      studentId: { in: records.map((r) => r.student.id) },
    },
    select: { studentId: true, rollNumber: true, status: true },
  });
  const rollByStudent = new Map<string, number>();
  for (const e of enrollments) {
    // An ACTIVE enrollment of that context wins over a historical one.
    if (!rollByStudent.has(e.studentId) || e.status === "ACTIVE") {
      rollByStudent.set(e.studentId, e.rollNumber);
    }
  }

  const studentInfo = records.map((r) => ({
    recordId: r.id,
    studentId: r.student.studentId,
    rollNumber: rollByStudent.get(r.student.id) ?? null,
    name: r.student.user.name,
    email: r.student.user.email,
    currentStatus: r.status,
    directCorrections: r.directCorrections,
  }));

  return {
    session: {
      id: session.id,
      attendanceDate: dateOnlyISO(session.attendanceDate),
      courseOffering: offering,
    },
    students: studentInfo,
    history: annotated,
  };
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

export async function listChangeRequests(opts: {
  /** Validated by the API route; the service only accepts real enum values. */
  status?: ChangeRequestStatus;
  courseOfferingId?: string;
  page: number;
  limit: number;
}) {
  const where: Prisma.AttendanceChangeRequestWhereInput = {};
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
            session: {
              include: {
                courseOffering: {
                  include: {
                    course: true,
                    section: true,
                    semester: true,
                    trade: true,
                    shift: true,
                    academicYear: true,
                  },
                },
              },
            },
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
      // An approved change edits the session, so it counts as one update.
      await tx.attendanceSession.update({
        where: { id: rec.sessionId },
        data: { updateCount: { increment: 1 } },
      });
      await tx.attendanceChangeLog.create({
        data: {
          recordId: rec.id,
          oldStatus: req.oldStatus,
          newStatus: req.newStatus,
          changedById: opts.reviewedById,
          reason: `Approved: ${req.reason}`,
        },
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

export type StudentAttendanceSummary = {
  offering: Prisma.CourseOfferingGetPayload<{
    include: { course: true; section: true; semester: true; trade: true; shift: true; academicYear: true };
  }>;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number;
};

export async function studentAttendanceSummary(
  studentId: string,
  courseOfferingId?: string,
): Promise<StudentAttendanceSummary[]> {
  const where: Prisma.AttendanceRecordWhereInput = { studentId };
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
    include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true },
  });
  return offerings.map((o) => {
    const s = byOffering.get(o.id)!;
    const pct = s.total ? Math.round(((s.present + s.late * 0.5 + s.excused * 0.5) / s.total) * 1000) / 10 : 0;
    return { offering: o, ...s, percentage: pct };
  });
}
