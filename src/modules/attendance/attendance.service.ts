import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { approvalRequired, conflict, notFound, businessRule, forbidden, validationError } from "@/lib/errors/errors";
import { Prisma, type AttendanceStatus, type ChangeRequestStatus } from "@prisma/client";
import {
  TEACHER_EDIT_WINDOW_DAYS,
  TEACHER_DIRECT_CORRECTIONS,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
  WITHDRAWN_REQUEST_NOTE,
  computeAttendancePermissions,
  isWithdrawnChangeRequest,
  resolveChangeRequestStatus,
  type AttendanceChangeRequestChange,
  type AttendanceEntryState,
  type AttendanceRequestDisplayStatus,
  type AttendanceReportItem,
  type AttendanceHistoryPayload,
  type AttendanceOfferingContext,
  type AttendanceSessionPermissions,
  type AttendanceSessionStudent,
  type AttendanceSessionSummary,
} from "./attendance.types";

export {
  TEACHER_EDIT_WINDOW_DAYS,
  TEACHER_DIRECT_CORRECTIONS,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
  WITHDRAWN_REQUEST_NOTE,
  computeAttendancePermissions,
  resolveChangeRequestStatus,
} from "./attendance.types";
export type {
  AttendanceChangeRequestChange,
  AttendanceEntryState,
  AttendanceReportItem,
  AttendanceHistoryPayload,
  AttendanceOfferingContext,
  AttendanceSessionPermissions,
  AttendanceSessionStudent,
  AttendanceSessionSummary,
} from "./attendance.types";

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

function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

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
 * Save one attendance-entry operation.
 *
 * `mode: "create"` is used by Take Attendance. It is deliberately a
 * create-only operation: if a session appears after the form was loaded, the
 * database unique constraint is converted to a 409 conflict instead of
 * silently editing the newly-created entry. `mode: "edit"` is used only by
 * the report editing workflow.
 *
 * The session updateCount is the authoritative correction quota. A single
 * operation may touch many records, but it increments that counter once.
 */
export async function saveSessionAttendance(opts: {
  courseOfferingId: string;
  attendanceDate: Date;
  records: { studentId: string; status: AttendanceStatus; note?: string }[];
  actorUserId: string;
  isAdmin: boolean;
  reason?: string;
  mode?: "create" | "edit";
}): Promise<AttendanceSaveResult> {
  if (opts.isAdmin) {
    throw forbidden("Admins cannot take or edit attendance directly. Review change requests instead.");
  }

  const offering = await prisma.courseOffering.findUnique({ where: { id: opts.courseOfferingId } });
  if (!offering) throw notFound("Course offering not found");
  const date = startOfDay(opts.attendanceDate);
  // Direct service callers from older integrations default to the historical
  // upsert behavior; the API always supplies an explicit mode. The create UI
  // therefore remains create-only while legacy internal callers do not break.
  const requestedMode = opts.mode ?? "auto";
  const duplicateIds = new Set<string>();
  for (const record of opts.records) {
    if (duplicateIds.has(record.studentId)) {
      throw validationError("Each student may appear only once in an attendance save");
    }
    duplicateIds.add(record.studentId);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      let session = await tx.attendanceSession.findUnique({
        where: { courseOfferingId_attendanceDate: { courseOfferingId: opts.courseOfferingId, attendanceDate: date } },
      });
      const isNewSession = !session;

      if (requestedMode === "create" && session) {
        throw conflict(
          `Attendance has already been recorded for ${dateOnlyISO(session.attendanceDate)}. View the Attendance Report to edit.`,
          { sessionId: session.id, courseOfferingId: opts.courseOfferingId, attendanceDate: dateOnlyISO(session.attendanceDate) },
        );
      }
      if (requestedMode === "edit" && !session) {
        throw conflict("This attendance entry no longer exists. Refresh and try again.");
      }

      if (!session) {
        session = await tx.attendanceSession.create({
          data: { courseOfferingId: opts.courseOfferingId, attendanceDate: date, createdById: opts.actorUserId },
        });
      } else if (daysOld(session.attendanceDate) > TEACHER_EDIT_WINDOW_DAYS) {
        throw businessRule(`Attendance older than ${TEACHER_EDIT_WINDOW_DAYS} days cannot be edited by teachers`);
      }

      // The route already checks the active teacher assignment. This second
      // database check ensures a client cannot submit students from another
      // course offering or academic context.
      const hasContext = Boolean(
        offering.academicYearId && offering.tradeId && offering.semesterId && offering.shiftId && offering.sectionId,
      );
      if (hasContext) {
        const enrollments = await tx.studentEnrollment.findMany({
          where: {
            academicYearId: offering.academicYearId,
            tradeId: offering.tradeId,
            semesterId: offering.semesterId,
            shiftId: offering.shiftId,
            sectionId: offering.sectionId,
            status: "ACTIVE",
          },
          select: { studentId: true },
        });
        const allowed = new Set(enrollments.map((enrollment) => enrollment.studentId));
        const invalid = opts.records.filter((record) => !allowed.has(record.studentId));
        if (invalid.length > 0) {
          throw validationError("Attendance can only be recorded for active students in this course offering", {
            studentIds: invalid.map((record) => record.studentId),
          });
        }
        if (isNewSession && opts.records.length !== allowed.size) {
          throw conflict("The course roster changed while attendance was being recorded. Refresh the roster and try again.");
        }
      }

      let createdCount = 0;
      let updatedCount = 0;
      const changedRecords: Array<{ id: string; oldStatus: AttendanceStatus | null; newStatus: AttendanceStatus }> = [];
      const operationId = randomUUID();

      for (const record of opts.records) {
        const existing = await tx.attendanceRecord.findUnique({
          where: { sessionId_studentId: { sessionId: session.id, studentId: record.studentId } },
        });
        if (!existing) {
          if (!isNewSession) {
            throw conflict("One or more attendance records changed while this form was open. Refresh and try again.");
          }
          const created = await tx.attendanceRecord.create({
            data: { sessionId: session.id, studentId: record.studentId, status: record.status, note: record.note },
          });
          changedRecords.push({ id: created.id, oldStatus: null, newStatus: record.status });
          createdCount += 1;
          continue;
        }

        if (isNewSession) {
          throw conflict("Attendance records already exist for this entry. Refresh and try again.");
        }
        if (existing.status !== record.status || (record.note !== undefined && record.note !== existing.note)) {
          changedRecords.push({ id: existing.id, oldStatus: existing.status, newStatus: record.status });
          const changed = await tx.attendanceRecord.updateMany({
            where: { id: existing.id, status: existing.status },
            data: { status: record.status, note: record.note ?? existing.note },
          });
          if (changed.count !== 1) throw conflict("Attendance changed concurrently. Refresh and try again.");
          updatedCount += 1;
        }
      }

      // Creation is not a correction. Direct editing is one operation even
      // when the operation changed many student records.
      if (!isNewSession && changedRecords.length > 0) {
        if (session.updateCount >= TEACHER_DIRECT_CORRECTIONS) {
          throw approvalRequired(
            "Direct correction capacity for this attendance entry is exhausted. Submit one change request for the complete entry.",
            { sessionId: session.id, correctionCapacityRemaining: 0 },
          );
        }
        const counted = await tx.attendanceSession.updateMany({
          where: { id: session.id, updateCount: { lt: TEACHER_DIRECT_CORRECTIONS } },
          data: { updateCount: { increment: 1 } },
        });
        if (counted.count !== 1) {
          throw approvalRequired(
            "Direct correction capacity for this attendance entry is exhausted. Submit one change request for the complete entry.",
            { sessionId: session.id, correctionCapacityRemaining: 0 },
          );
        }
      }

      for (const changed of changedRecords) {
        await tx.attendanceChangeLog.create({
          data: {
            recordId: changed.id,
            oldStatus: changed.oldStatus,
            newStatus: changed.newStatus,
            changedById: opts.actorUserId,
            reason: opts.reason?.trim() || (isNewSession ? "Initial entry" : "Direct attendance correction"),
            changeType: isNewSession ? "INITIAL_ENTRY" : "DIRECT_CORRECTION",
            operationId,
          },
        });
      }

      return { sessionId: session.id, isNewSession, createdCount, updatedCount, skipped: [] };
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      throw conflict(
        `Attendance has already been recorded for ${dateOnlyISO(date)}. View the Attendance Report to edit.`,
        { courseOfferingId: opts.courseOfferingId, attendanceDate: dateOnlyISO(date) },
      );
    }
    if (prismaErrorCode(error) === "P2034") {
      throw conflict("Attendance changed concurrently. Refresh and review the existing attendance entry.");
    }
    throw error;
  }
}

export async function getSession(courseOfferingId: string, date: Date) {
  const d = startOfDay(date);
  return prisma.attendanceSession.findUnique({
    where: { courseOfferingId_attendanceDate: { courseOfferingId, attendanceDate: d } },
    include: {
      // The offering context is required for the roster lookup below (its five
      // academic foreign keys scope the enrollments) and for the page header.
      courseOffering: { select: attendanceOfferingContextSelect },
      records: {
        include: { student: { include: { user: { select: { name: true, email: true } } } } },
        orderBy: { student: { studentId: "asc" } },
      },
    },
  });
}

/**
 * AttendanceRecord row as the roster builder needs it.
 *
 * Both `studentId` (the FK) and the included `student` relation are optional
 * because the builder is fed by two call sites: the API route (records include
 * `student`) and the teacher editor (full rows). Students are keyed by
 * `studentId ?? student.id`, which are the same value for a real Prisma row.
 */
type SessionRecordLike = {
  id: string;
  studentId?: string | null;
  status?: string | null;
  note?: string | null;
  directCorrections?: number | null;
  student?: { id: string; studentId?: string | null; user?: { name?: string | null; email?: string | null } | null } | null;
};

/** ACTIVE enrollment row of the offering's section, with the student profile. */
type EnrollmentLike = {
  rollNumber?: number | null;
  student?: { id?: string; studentId?: string; user?: { name?: string | null; email?: string | null } | null } | null;
};

/**
 * Section enrollment rows for an offering, scoped by the FULL academic context.
 *
 * NEVER filter by `sectionId` alone: section names repeat across academic
 * years/trades/semesters/shifts, so a partial filter would mix roll numbers of
 * unrelated enrollments (the bug that broke the history endpoint).
 */
export async function fetchOfferingEnrollments(
  offering: AttendanceOfferingContext | null | undefined,
): Promise<EnrollmentLike[]> {
  const hasContext = Boolean(
    offering?.academicYearId && offering?.tradeId && offering?.semesterId && offering?.shiftId && offering?.sectionId,
  );
  if (!hasContext || !offering) return [];
  return prisma.studentEnrollment.findMany({
    where: {
      academicYearId: offering.academicYearId,
      tradeId: offering.tradeId,
      semesterId: offering.semesterId,
      shiftId: offering.shiftId,
      sectionId: offering.sectionId,
      status: "ACTIVE",
    },
    include: { student: { select: { id: true, studentId: true, user: { select: { name: true, email: true } } } } },
    orderBy: { rollNumber: "asc" },
  });
}

/**
 * Merge a session's recorded statuses with the complete section roster.
 *
 * Shared by the Student Status endpoint and the Take Attendance editor, so the
 * two screens can never disagree about who is in the class or what was
 * recorded. Students without a record yet are returned as NOT_MARKED — the
 * teacher sees the gap instead of a silently missing row.
 */
export function buildAttendanceRoster(
  records: SessionRecordLike[],
  enrollments: EnrollmentLike[],
): { roster: AttendanceSessionStudent[]; summary: AttendanceSessionSummary } {
  const recordByStudent = new Map<string, SessionRecordLike>();
  for (const record of records) {
    const key = record.studentId ?? record.student?.id ?? "";
    if (key) recordByStudent.set(key, record);
  }

  const fromEnrollment = (enrollment: EnrollmentLike): AttendanceSessionStudent => {
    const studentId = enrollment.student?.id ?? "";
    const record = recordByStudent.get(studentId);
    recordByStudent.delete(studentId);
    return {
      id: record?.id ?? null,
      studentPk: studentId,
      rollNumber: enrollment.rollNumber ?? null,
      studentId: enrollment.student?.studentId ?? "",
      studentName: enrollment.student?.user?.name ?? "",
      studentEmail: enrollment.student?.user?.email ?? "",
      status: record?.status ?? "NOT_MARKED",
      hasRecord: Boolean(record),
      note: record?.note ?? null,
      directCorrections: record?.directCorrections ?? 0,
    };
  };

  let roster = enrollments.map(fromEnrollment);
  if (roster.length === 0) {
    // No resolvable roster (incomplete academic context, or the section has no
    // ACTIVE enrollment any more): fall back to the recorded rows so the
    // teacher can still read the attendance that exists.
    roster = records.map((record) => ({
      id: record.id,
      studentPk: record.student?.id ?? record.studentId ?? "",
      rollNumber: null,
      studentId: record.student?.studentId ?? "",
      studentName: record.student?.user?.name ?? "",
      studentEmail: record.student?.user?.email ?? "",
      status: record.status ?? "NOT_MARKED",
      hasRecord: true,
      note: record.note ?? null,
      directCorrections: record.directCorrections ?? 0,
    }));
  }

  const summary: AttendanceSessionSummary = { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
  for (const record of records) {
    summary.total += 1;
    if (record.status === "PRESENT") summary.present += 1;
    else if (record.status === "ABSENT") summary.absent += 1;
    else if (record.status === "LATE") summary.late += 1;
    else if (record.status === "EXCUSED") summary.excused += 1;
  }

  return { roster, summary };
}

/**
 * Student Status payload for one session (used by the report dialog and the
 * Take Attendance read-only view).
 */
export async function getSessionRoster(sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      courseOffering: { select: attendanceOfferingContextSelect },
      records: {
        include: { student: { include: { user: { select: { name: true, email: true } } } } },
        orderBy: { student: { studentId: "asc" } },
      },
    },
  });
  if (!session) throw notFound("Attendance session not found");
  const enrollments = await fetchOfferingEnrollments(session.courseOffering as unknown as AttendanceOfferingContext);
  const { roster, summary } = buildAttendanceRoster(session.records as unknown as SessionRecordLike[], enrollments);
  return {
    session: {
      id: session.id,
      attendanceDate: dateOnlyISO(session.attendanceDate),
      courseOffering: session.courseOffering,
    },
    records: roster,
    summary,
  };
}

/**
 * Authoritative state of one CourseOffering + date for the Take Attendance page:
 * the recorded attendance (or `null` when nothing was recorded yet), the
 * summary, the correction state and the single pending change request.
 *
 * The permission object is computed from the stored session counter and the
 * current server time; clients never send a quota, teacher id, or
 * authorization flag back as authority.
 */
export async function getSessionForAttendanceEditor(courseOfferingId: string, date: Date, canEdit = true): Promise<AttendanceEntryState | null> {
  const session = await getSession(courseOfferingId, date);
  if (!session) return null;
  const pending = await prisma.attendanceChangeRequest.findFirst({
    where: { sessionId: session.id, status: "PENDING" },
    select: { id: true, reason: true, status: true, createdAt: true, _count: { select: { changes: true } } },
  });
  const permissions = computeAttendancePermissions({
    updateCount: session.updateCount,
    attendanceDateAgeDays: daysOld(session.attendanceDate),
    canEdit,
    hasPendingChangeRequest: Boolean(pending),
  });
  const enrollments = await fetchOfferingEnrollments(session.courseOffering as unknown as AttendanceOfferingContext);
  const { roster, summary } = buildAttendanceRoster(session.records as unknown as SessionRecordLike[], enrollments);
  return {
    id: session.id,
    courseOfferingId: session.courseOfferingId,
    attendanceDate: dateOnlyISO(session.attendanceDate),
    updateCount: session.updateCount,
    note: session.note ?? null,
    summary,
    roster,
    permissions,
    pendingChangeRequest: pending
      ? {
          id: pending.id,
          reason: pending.reason,
          status: pending.status,
          displayStatus: resolveChangeRequestStatus(pending),
          createdAt: pending.createdAt.toISOString(),
          changeCount: pending._count.changes,
        }
      : null,
  };
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
  /** Whether the caller may correct entries at all (teachers only). */
  canEdit?: boolean;
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

  // The report must show WHICH entries are locked behind an approval, so the
  // single pending request per entry is fetched for the whole page in one query
  // (at most one PENDING row per session is possible — the partial unique index
  // `AttendanceChangeRequest_one_pending_per_session_key` guarantees it).
  const pendingRows =
    (await prisma.attendanceChangeRequest.findMany({
      where: { sessionId: { in: sessionIds }, status: "PENDING" },
      select: { id: true, sessionId: true, reason: true, status: true, createdAt: true, _count: { select: { changes: true } } },
    })) ?? [];
  const pendingBySession = new Map<string, NonNullable<AttendanceReportItem["pendingChangeRequest"]>>();
  for (const request of pendingRows) {
    if (!request?.sessionId) continue;
    pendingBySession.set(request.sessionId, {
      id: request.id,
      reason: request.reason,
      status: request.status,
      displayStatus: resolveChangeRequestStatus(request),
      createdAt: request.createdAt.toISOString(),
      changeCount: request._count?.changes ?? 0,
    });
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
    // Correction + request state is computed here (server-side) so the report
    // and the Take Attendance page can never disagree about what the teacher is
    // allowed to do with an entry.
    permissions: computeAttendancePermissions({
      updateCount: s.updateCount,
      attendanceDateAgeDays: daysOld(s.attendanceDate),
      canEdit: opts.canEdit ?? false,
      hasPendingChangeRequest: pendingBySession.has(s.id),
    }),
    pendingChangeRequest: pendingBySession.get(s.id) ?? null,
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

  // Requests are session-scoped. Their child items retain every proposed
  // student change, including rejected requests, so the history stays intact.
  const [logs, relatedRequests] = await Promise.all([
    prisma.attendanceChangeLog.findMany({
      where: { recordId: { in: recordIds } },
      orderBy: { createdAt: "desc" },
      include: { changedBy: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.attendanceChangeRequest.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      include: {
        changes: true,
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        reviewedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  const requestById = new Map(relatedRequests.map((request) => [request.id, request] as const));
  const requestByRecordOldNew = new Map<string, (typeof relatedRequests)[number]>();
  for (const request of relatedRequests) {
    for (const change of request.changes) {
      const key = `${change.recordId}:${change.oldStatus}->${change.newStatus}`;
      if (!requestByRecordOldNew.has(key)) requestByRecordOldNew.set(key, request);
    }
  }

  const annotated = logs.map((log) => {
    const request = (log.requestId ? requestById.get(log.requestId) : undefined)
      ?? requestByRecordOldNew.get(`${log.recordId}:${log.oldStatus}->${log.newStatus}`);
    return {
      id: log.id,
      recordId: log.recordId,
      oldStatus: log.oldStatus,
      newStatus: log.newStatus,
      reason: log.reason,
      timestamp: log.createdAt.toISOString(),
      changedBy: {
        id: log.changedBy.id,
        name: log.changedBy.name,
        email: log.changedBy.email,
        role: log.changedBy.role,
      },
      changeType: log.oldStatus == null ? ("INITIAL_ENTRY" as const) : ("CORRECTION" as const),
      operationId: log.operationId,
      requestId: log.requestId,
      viaApproval: log.changeType === "APPROVED_REQUEST" || Boolean(request),
      relatedChangeRequest: request
        ? {
            id: request.id,
            status: request.status,
            requestedBy: { id: request.requestedBy.id, name: request.requestedBy.name, role: request.requestedBy.role },
            reviewedBy: request.reviewedBy
              ? { id: request.reviewedBy.id, name: request.reviewedBy.name, role: request.reviewedBy.role }
              : null,
            reviewedAt: request.reviewedAt?.toISOString() ?? null,
            reviewNote: request.reviewNote ?? null,
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
      changeLogs: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true, email: true } }, request: true } },
      changeRequestItems: { orderBy: { createdAt: "desc" }, include: { changeRequest: true } },
      session: true,
      student: { include: { user: { select: { name: true } } } },
    },
  });
  if (!rec) throw notFound("Attendance record not found");
  return rec;
}

// ---- Attendance-entry change requests (approval workflow)
export type AttendanceChangeProposal = {
  recordId: string;
  newStatus: AttendanceStatus;
};

/**
 * Submit ONE approval request for a whole attendance entry.
 *
 * Every guard the UI applies is re-applied here — a stale or hand-crafted
 * client payload must never create a second review path:
 *
 *   1. reason is mandatory, and the change set must be non-empty and unique;
 *   2. the session must exist (the route re-verifies the teacher's ACTIVE
 *      assignment for the session's CourseOffering, never trusting a
 *      client-supplied teacherId);
 *   3. an entry with direct correction capacity left must NOT be escalated to
 *      an admin (quota = AttendanceSession.updateCount, authoritative);
 *   4. at most ONE pending request per entry — checked inside the transaction
 *      and guaranteed by the partial unique index
 *      `AttendanceChangeRequest_one_pending_per_session_key`, so two concurrent
 *      submissions cannot both become active (the loser gets P2002 -> 409);
 *   5. every proposed record must belong to this session, and its proposed
 *      status must differ from the CURRENT status (a stale edit is rejected
 *      instead of silently overwriting whatever an approval changed).
 */
export async function createChangeRequest(data: {
  sessionId: string;
  changes: AttendanceChangeProposal[];
  reason: string;
  requestedById: string;
}) {
  const reason = data.reason.trim();
  if (!reason) throw businessRule("A reason is required for an attendance-entry change request");
  if (data.changes.length === 0) throw validationError("At least one proposed attendance change is required");
  if (new Set(data.changes.map((change) => change.recordId)).size !== data.changes.length) {
    throw validationError("Each attendance record may appear only once in a change request");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findUnique({ where: { id: data.sessionId } });
      if (!session) throw notFound("Attendance session not found");
      if (session.updateCount < TEACHER_DIRECT_CORRECTIONS) {
        throw conflict(
          "This attendance entry still has direct correction capacity. Save a direct correction instead of requesting approval.",
          { sessionId: session.id, correctionCapacityRemaining: TEACHER_DIRECT_CORRECTIONS - session.updateCount },
        );
      }

      const pending = await tx.attendanceChangeRequest.findFirst({
        where: { sessionId: session.id, status: "PENDING" },
        select: { id: true },
      });
      if (pending) {
        throw conflict("This attendance entry already has a request awaiting admin review. Cancel it before submitting another.", {
          requestId: pending.id,
        });
      }

      const recordIds = data.changes.map((change) => change.recordId);
      const records = await tx.attendanceRecord.findMany({
        where: { id: { in: recordIds } },
        select: { id: true, sessionId: true, status: true },
      });
      if (records.length !== recordIds.length || records.some((record) => record.sessionId !== session.id)) {
        throw validationError("Every proposed attendance record must belong to the selected attendance entry");
      }
      const recordById = new Map(records.map((record) => [record.id, record] as const));
      const changes = data.changes.map((change) => {
        const record = recordById.get(change.recordId);
        if (!record) throw validationError("Attendance record not found in this attendance entry");
        if (record.status === change.newStatus) {
          throw validationError("A proposed attendance status must differ from its current status", { recordId: record.id });
        }
        return { recordId: record.id, oldStatus: record.status, newStatus: change.newStatus };
      });

      const created = await tx.attendanceChangeRequest.create({
        data: {
          sessionId: session.id,
          requestedById: data.requestedById,
          reason,
          changes: { create: changes },
        },
        select: {
          id: true,
          sessionId: true,
          requestedById: true,
          reason: true,
          status: true,
          createdAt: true,
          _count: { select: { changes: true } },
        },
      });
      return {
        ...created,
        displayStatus: resolveChangeRequestStatus(created),
        changeCount: created._count.changes,
        canCancel: created.status === "PENDING" && created.requestedById === data.requestedById,
      };
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      // Lost the race against another submission for the same entry: the partial
      // unique index is the last line of defence, the 409 above is the fast path.
      throw conflict("This attendance entry already has a request awaiting admin review. Cancel it before submitting another.");
    }
    if (prismaErrorCode(error) === "P2034") {
      throw conflict("Another change request was submitted at the same time. Refresh the attendance entry.");
    }
    throw error;
  }
}

type AttendanceChangeRequestReviewItem = {
  id: string;
  sessionId: string;
  requestedById: string;
  reason: string;
  status: ChangeRequestStatus;
  /**
   * Status as the teacher must see it. CANCELLATION has no enum value in the
   * (frozen) `ChangeRequestStatus` schema, so a withdrawn request is stored as
   * REJECTED + `WITHDRAWN_REQUEST_NOTE` and surfaced here as CANCELLED.
   */
  displayStatus: AttendanceRequestDisplayStatus;
  /** True when this REJECTED row is a teacher cancellation, not an admin rejection. */
  withdrawn: boolean;
  /** Number of students affected (mirrors changes.length). */
  changeCount: number;
  /** Server-computed "the caller may withdraw this": pending AND own request. */
  canCancel: boolean;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string; email: string };
  reviewedBy: { id: string; name: string; email: string } | null;
  session: {
    id: string;
    attendanceDate: string;
    courseOffering: Prisma.CourseOfferingGetPayload<{ include: {
      course: true; section: true; semester: true; trade: true; shift: true; academicYear: true;
    } }>;
  };
  changes: Array<{
    id: string;
    recordId: string;
    studentId: string;
    rollNumber: number | null;
    studentName: string;
    studentEmail: string;
    oldStatus: AttendanceStatus;
    newStatus: AttendanceStatus;
  }>;
};

export async function listChangeRequests(opts: {
  status?: ChangeRequestStatus;
  courseOfferingId?: string;
  sessionId?: string;
  /**
   * Hard ownership filter. The API route always sets this for TEACHER callers,
   * so a teacher can only ever read their own requests (IDOR-safe by
   * construction rather than by a post-filter).
   */
  requestedById?: string;
  /** Actor used to compute `canCancel`; without it nothing is cancellable. */
  actorUserId?: string;
  page: number;
  limit: number;
}) {
  const where: Prisma.AttendanceChangeRequestWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.requestedById) where.requestedById = opts.requestedById;
  if (opts.sessionId) where.sessionId = opts.sessionId;
  if (opts.courseOfferingId) where.session = { courseOfferingId: opts.courseOfferingId };
  const [total, rows] = await prisma.$transaction([
    prisma.attendanceChangeRequest.count({ where }),
    prisma.attendanceChangeRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      include: {
        changes: { include: { record: { include: { student: { include: { user: { select: { id: true, name: true, email: true } } } } } } } },
        session: { include: { courseOffering: { include: { course: true, section: true, semester: true, trade: true, shift: true, academicYear: true } } } },
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const enrollmentQueries = rows.map((row) => ({
    sessionId: row.sessionId,
    academicYearId: row.session.courseOffering.academicYearId,
    tradeId: row.session.courseOffering.tradeId,
    semesterId: row.session.courseOffering.semesterId,
    shiftId: row.session.courseOffering.shiftId,
    sectionId: row.session.courseOffering.sectionId,
  }));
  const studentIds = rows.flatMap((row) => row.changes.map((change) => change.record.student.id));
  const enrollments = rows.length === 0 || studentIds.length === 0
    ? []
    : await prisma.studentEnrollment.findMany({
        where: {
          studentId: { in: studentIds },
          OR: enrollmentQueries.map((context) => ({
            academicYearId: context.academicYearId,
            tradeId: context.tradeId,
            semesterId: context.semesterId,
            shiftId: context.shiftId,
            sectionId: context.sectionId,
          })),
        },
        select: { studentId: true, academicYearId: true, tradeId: true, semesterId: true, shiftId: true, sectionId: true, rollNumber: true, status: true },
      });
  const rollByContext = new Map<string, number>();
  for (const enrollment of enrollments) {
    const key = `${enrollment.academicYearId}:${enrollment.tradeId}:${enrollment.semesterId}:${enrollment.shiftId}:${enrollment.sectionId}:${enrollment.studentId}`;
    if (!rollByContext.has(key) || enrollment.status === "ACTIVE") rollByContext.set(key, enrollment.rollNumber);
  }

  const items: AttendanceChangeRequestReviewItem[] = rows.map((row) => {
    const offering = row.session.courseOffering;
    const contextKey = (studentId: string) => `${offering.academicYearId}:${offering.tradeId}:${offering.semesterId}:${offering.shiftId}:${offering.sectionId}:${studentId}`;
    const displayStatus = resolveChangeRequestStatus(row);
    return {
      id: row.id,
      sessionId: row.sessionId,
      requestedById: row.requestedById,
      reason: row.reason,
      status: row.status,
      displayStatus,
      withdrawn: isWithdrawnChangeRequest(row),
      changeCount: row.changes.length,
      // Allowed actions are decided here (status + ownership), not in the UI.
      canCancel: row.status === "PENDING" && Boolean(opts.actorUserId) && row.requestedById === opts.actorUserId,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      createdAt: row.createdAt.toISOString(),
      requestedBy: row.requestedBy,
      reviewedBy: row.reviewedBy,
      session: { id: row.session.id, attendanceDate: dateOnlyISO(row.session.attendanceDate), courseOffering: offering },
      changes: row.changes.map((change) => ({
        id: change.id,
        recordId: change.recordId,
        studentId: change.record.student.studentId,
        rollNumber: rollByContext.get(contextKey(change.record.student.id)) ?? null,
        studentName: change.record.student.user.name,
        studentEmail: change.record.student.user.email,
        oldStatus: change.oldStatus,
        newStatus: change.newStatus,
      })),
    };
  });
  return { items, total };
}

export async function reviewChangeRequest(id: string, opts: { approve: boolean; reviewedById: string; reviewNote?: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const request = await tx.attendanceChangeRequest.findUnique({
        where: { id },
        include: { changes: true },
      });
      if (!request) throw notFound("Change request not found");
      if (request.status !== "PENDING") throw conflict("Request already reviewed");

      if (!opts.approve) {
        const rejected = await tx.attendanceChangeRequest.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "REJECTED", reviewedById: opts.reviewedById, reviewedAt: new Date(), reviewNote: opts.reviewNote },
        });
        if (rejected.count !== 1) throw conflict("Request was already reviewed");
        // Same-transaction read: the row was just updated, so it cannot be
        // missing; throw keeps the return type non-null for callers.
        const rejectedRequest = await tx.attendanceChangeRequest.findUnique({ where: { id }, include: { changes: true } });
        if (!rejectedRequest) throw notFound("Change request not found");
        return rejectedRequest;
      }

      const session = await tx.attendanceSession.findUnique({ where: { id: request.sessionId } });
      if (!session) throw notFound("Attendance session not found");
      if (request.changes.length === 0) throw validationError("The change request contains no proposed changes");
      const records = await tx.attendanceRecord.findMany({ where: { id: { in: request.changes.map((change) => change.recordId) } } });
      if (records.length !== request.changes.length || records.some((record) => record.sessionId !== session.id)) {
        throw conflict("This request is stale because one or more attendance records no longer belong to the attendance entry");
      }
      const recordById = new Map(records.map((record) => [record.id, record] as const));
      for (const change of request.changes) {
        const record = recordById.get(change.recordId);
        if (!record || record.status !== change.oldStatus) {
          throw conflict("This request is stale because attendance changed after it was submitted");
        }
      }

      const approved = await tx.attendanceChangeRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: opts.reviewedById, reviewedAt: new Date(), reviewNote: opts.reviewNote },
      });
      if (approved.count !== 1) throw conflict("Request was already reviewed");

      const operationId = randomUUID();
      for (const change of request.changes) {
        const record = recordById.get(change.recordId);
        if (!record) throw conflict("Requested attendance record no longer exists");
        const changed = await tx.attendanceRecord.updateMany({
          where: { id: record.id, status: change.oldStatus },
          data: { status: change.newStatus },
        });
        if (changed.count !== 1) throw conflict("This request is stale because attendance changed after it was submitted");
        await tx.attendanceChangeLog.create({
          data: {
            recordId: record.id,
            oldStatus: change.oldStatus,
            newStatus: change.newStatus,
            changedById: opts.reviewedById,
            reason: `Approved attendance-entry request: ${request.reason}`,
            changeType: "APPROVED_REQUEST",
            operationId,
            requestId: request.id,
          },
        });
      }
      await tx.attendanceSession.update({ where: { id: session.id }, data: { updateCount: { increment: 1 } } });
      // Same-transaction read: the row was just updated, so it cannot be
      // missing; throw keeps the return type non-null for callers.
      const approvedRequest = await tx.attendanceChangeRequest.findUnique({ where: { id }, include: { changes: true } });
      if (!approvedRequest) throw notFound("Change request not found");
      return approvedRequest;
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2034") {
      throw conflict("This request was reviewed concurrently. Refresh the approval queue.");
    }
    throw error;
  }
}

/**
 * Withdraw a pending attendance-entry request.
 *
 * Rules enforced here (the UI repeats them only for affordance reasons):
 *   - the request must exist and belong to the acting teacher;
 *   - only a PENDING request can be withdrawn — an approved or rejected one is
 *     already an admin decision and must not be rewritten;
 *   - nothing is deleted. The request row, its `AttendanceChangeRequestItem`
 *     proposals and every change log stay for auditing.
 *
 * Schema limitation (frozen by the task): `ChangeRequestStatus` has no
 * CANCELLED value, so a cancellation is recorded as REJECTED with the machine
 * readable `WITHDRAWN_REQUEST_NOTE` marker, which `resolveChangeRequestStatus`
 * turns back into the CANCELLED display state.
 *
 * Concurrency: the status update is a conditional `updateMany` on
 * `status = "PENDING"`. If an admin approves or rejects in the same instant,
 * that transaction wins the row lock, our guard matches zero rows, and the
 * teacher gets a 409 that tells them to look at the decision — the request is
 * never flipped back to pending and an approval is never undone. Freeing the
 * pending slot also means a new request for the entry becomes possible.
 */
export async function cancelChangeRequest(id: string, opts: { actorUserId: string; note?: string }) {
  const note = opts.note?.trim();
  try {
    return await prisma.$transaction(async (tx) => {
      const request = await tx.attendanceChangeRequest.findUnique({
        where: { id },
        select: {
          id: true,
          sessionId: true,
          requestedById: true,
          status: true,
          reason: true,
          reviewNote: true,
          _count: { select: { changes: true } },
        },
      });
      if (!request) throw notFound("Change request not found");
      if (request.requestedById !== opts.actorUserId) {
        throw forbidden("Only the teacher who submitted this attendance change request can cancel it");
      }
      if (request.status !== "PENDING") {
        throw conflict(
          request.status === "APPROVED"
            ? "This request has already been approved, so it can no longer be cancelled."
            : "This request has already been reviewed, so it can no longer be cancelled.",
          { requestId: request.id, status: request.status },
        );
      }

      const cancelled = await tx.attendanceChangeRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "REJECTED",
          // Marker first so `isWithdrawnChangeRequest` keeps working even when
          // the teacher added a free-text explanation.
          reviewNote: note ? `${WITHDRAWN_REQUEST_NOTE} ${note}` : WITHDRAWN_REQUEST_NOTE,
          reviewedById: opts.actorUserId,
          reviewedAt: new Date(),
        },
      });
      if (cancelled.count !== 1) {
        throw conflict("This request was reviewed by an admin while you were cancelling it. Refresh to see the final decision.");
      }

      return {
        id: request.id,
        sessionId: request.sessionId,
        status: "REJECTED" as const,
        displayStatus: "CANCELLED" as const,
        reason: request.reason,
        changeCount: request._count.changes,
      };
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2034") {
      throw conflict("This request was reviewed concurrently. Refresh to see the final decision.");
    }
    throw error;
  }
}

/**
 * Count of the caller's PENDING requests, optionally narrowed to one offering.
 * Backs the "Pending Update Requests (N)" badge, so the number is always the
 * database's, never a client-side tally.
 */
export async function countPendingChangeRequests(opts: { requestedById?: string; courseOfferingId?: string }) {
  return prisma.attendanceChangeRequest.count({
    where: {
      status: "PENDING",
      ...(opts.requestedById ? { requestedById: opts.requestedById } : {}),
      ...(opts.courseOfferingId ? { session: { courseOfferingId: opts.courseOfferingId } } : {}),
    },
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
