import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, businessRule, approvalRequired } from "@/lib/errors/errors";
import type { AttendanceStatus } from "@prisma/client";
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
          data: {
            recordId: rec.id,
            oldStatus: null,
            newStatus: r.status,
            changedById: opts.actorUserId,
            reason: "Initial entry",
          },
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
            recordId: existing.id,
            oldStatus: existing.status,
            newStatus: r.status,
            changedById: opts.actorUserId,
            reason: opts.reason ?? (opts.isAdmin ? "Admin correction" : "Correction"),
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

/**
 * Dedicated Attendance Report listing.
 *
 * Server-side pagination + date filtering. Summaries are aggregated in the DB
 * (groupBy on AttendanceRecord) so we never load every record for a course.
 * Update count is the number of AttendanceChangeLog entries for the session's
 * records where `oldStatus` is not null (initial entry has oldStatus=null).
 */
export async function listAttendanceReport(opts: {
  courseOfferingId: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sort?: "attendanceDate";
  order?: "asc" | "desc";
}) {
  const courseOfferingId = opts.courseOfferingId;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const requestedSize = Math.floor(opts.pageSize ?? DEFAULT_ATTENDANCE_PAGE_SIZE);
  const pageSize = Math.min(MAX_ATTENDANCE_PAGE_SIZE, Math.max(1, requestedSize));
  const order = opts.order === "asc" ? "asc" : "desc";
  const sort = opts.sort ?? "attendanceDate";

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (opts.from) dateFilter.gte = startOfDay(opts.from);
  if (opts.to) dateFilter.lte = startOfDay(opts.to);

  const sessionWhere: Record<string, unknown> = { courseOfferingId };
  if (dateFilter.gte || dateFilter.lte) sessionWhere.attendanceDate = dateFilter;

  const [total, sessions] = await prisma.$transaction([
    prisma.attendanceSession.count({ where: sessionWhere }),
    prisma.attendanceSession.findMany({
      where: sessionWhere,
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, courseOfferingId: true, attendanceDate: true, createdById: true, createdAt: true, updatedAt: true },
    }),
  ]);

  if (sessions.length === 0) {
    return { items: [] as AttendanceReportItem[], total, page, pageSize };
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

  // Count modifications per session: change log rows where oldStatus is set
  // (initial entries have oldStatus=null and are not counted).
  const changeCounts = await countModificationsBySession(sessionIds);

  const items: AttendanceReportItem[] = sessions.map((s) => ({
    id: s.id,
    courseOfferingId: s.courseOfferingId,
    attendanceDate: dateOnlyISO(s.attendanceDate),
    createdById: s.createdById,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    summary: summaries.get(s.id) ?? { total: 0, present: 0, absent: 0, late: 0, excused: 0 },
    updateCount: changeCounts.get(s.id) ?? 0,
  }));

  return { items, total, page, pageSize };
}

/**
 * Returns the count of AttendanceChangeLog rows per sessionId where the change
 * represents a real modification (oldStatus IS NOT NULL). Initial-entry logs
 * (oldStatus IS NULL) are excluded by design — see spec §8.
 *
 * The session of a log is reached through the `record` relation
 * (AttendanceChangeLog.recordId -> AttendanceRecord.sessionId). That link is the single
 * source of truth and is always populated; a nullable denormalized copy on the log row
 * would have to be backfilled or historical sessions would silently report zero updates.
 * Both sides are indexed (`AttendanceChangeLog.recordId`, `AttendanceRecord`
 * unique (sessionId, studentId)), and the result set is bounded by the number of
 * modifications on the requested page, not by the number of records.
 */
async function countModificationsBySession(sessionIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sessionIds.length === 0) return counts;

  const rows = await prisma.attendanceChangeLog.findMany({
    where: {
      oldStatus: { not: null },
      record: { sessionId: { in: sessionIds } },
    },
    select: { record: { select: { sessionId: true } } },
  });

  for (const row of rows) {
    const sessionId = row.record.sessionId;
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }
  return counts;
}

/** Session-scoped change history: every student-level change tied to a session. */
export async function getSessionHistory(sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      courseOffering: { select: { id: true, course: { select: { title: true, code: true } }, section: { select: { name: true } } } },
    },
  });
  if (!session) throw notFound("Attendance session not found");

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

  // Pull logs and approved requests in parallel.
  const [logs, approvedRequests] = await Promise.all([
    prisma.attendanceChangeLog.findMany({
      where: { recordId: { in: recordIds } },
      orderBy: { createdAt: "desc" },
      include: {
        changedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.attendanceChangeRequest.findMany({
      where: { recordId: { in: recordIds }, status: { in: ["APPROVED", "PENDING", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        reviewedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  // Annotate each change-log row with a changeType and whether it was approval-based.
  const requestByRecordOldNew = new Map<string, typeof approvedRequests[number]>();
  for (const r of approvedRequests) {
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
      changeType: l.oldStatus == null ? "INITIAL_ENTRY" : "CORRECTION",
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

  const studentInfo = records.map((r) => ({
    recordId: r.id,
    studentId: r.student.studentId,
    name: r.student.user.name,
    email: r.student.user.email,
    currentStatus: r.status,
    directCorrections: r.directCorrections,
  }));

  return {
    session: {
      id: session.id,
      attendanceDate: dateOnlyISO(session.attendanceDate),
      courseOffering: session.courseOffering,
    },
    students: studentInfo,
    history: annotated,
  };
}

function dateOnlyISO(d: Date): string {
  // Returns yyyy-mm-dd without timezone drift.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
