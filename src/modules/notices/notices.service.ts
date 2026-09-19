import { randomUUID } from "crypto";
import type { AuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors/errors";
import { logger } from "@/lib/logging/logger";
import {
  NOTICE_ATTACHMENT_MAX_COUNT,
  NOTICE_ATTACHMENT_MAX_TOTAL_BYTES,
  storage,
  validateNoticeAttachmentBatch,
  type NoticeAttachmentUpload,
  type ValidatedNoticeAttachment,
} from "@/lib/storage/storage";
import { notifyInTransaction } from "@/lib/notifications/notify";
import { enqueue } from "@/lib/notifications/queue";
import type { Prisma } from "@prisma/client";

export type NoticeTargetKind = "EVERYONE" | "ADMINS" | "COURSE_OFFERING" | "TEACHER" | "STUDENT";

export interface NoticeTargetInput {
  type: NoticeTargetKind;
  ids: string[];
}

export interface NoticeWriteInput {
  title?: string;
  content?: string;
  expiresAt?: Date | null;
  targets?: NoticeTargetInput[];
  expectedVersion?: number;
  removeAttachmentIds?: string[];
}

export interface NoticeFileUpload extends NoticeAttachmentUpload {}

interface ResolvedTargets {
  rows: { targetType: NoticeTargetKind; targetId: string }[];
  recipientUserIds: string[];
  primaryCourseOfferingId: string | null;
}

interface StoredNoticeFile {
  key: string;
  bucket: string;
  validated: ValidatedNoticeAttachment;
}

const TARGET_KINDS = new Set<NoticeTargetKind>([
  "EVERYONE",
  "ADMINS",
  "COURSE_OFFERING",
  "TEACHER",
  "STUDENT",
]);
const GROUP_TARGETS = new Set<NoticeTargetKind>(["EVERYONE", "ADMINS"]);
const GROUP_TARGET_SENTINEL = "*";

const offeringInclude = {
  course: true,
  section: true,
  semester: true,
  trade: true,
  shift: true,
  academicYear: true,
} as const;

function contextWhere(offering: {
  academicYearId: string;
  tradeId: string;
  semesterId: string;
  shiftId: string;
  sectionId: string;
}): Prisma.StudentEnrollmentWhereInput {
  return {
    academicYearId: offering.academicYearId,
    tradeId: offering.tradeId,
    semesterId: offering.semesterId,
    shiftId: offering.shiftId,
    sectionId: offering.sectionId,
  };
}

function targetKey(type: NoticeTargetKind, id: string): string {
  return `${type}:${id}`;
}

function normalizeTargets(targets: NoticeTargetInput[]): { type: NoticeTargetKind; ids: string[] }[] {
  const normalized: { type: NoticeTargetKind; ids: string[] }[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    if (!TARGET_KINDS.has(target.type)) throw validationError("Invalid notice recipient target");
    const ids = [...new Set(target.ids.map((id) => id.trim()).filter(Boolean))];
    if (GROUP_TARGETS.has(target.type)) {
      if (ids.length > 0) throw validationError("Group recipient targets do not accept IDs");
      const key = targetKey(target.type, GROUP_TARGET_SENTINEL);
      if (!seen.has(key)) {
        normalized.push({ type: target.type, ids: [] });
        seen.add(key);
      }
      continue;
    }
    if (ids.length === 0) throw validationError("Select at least one recipient for each target type");
    const accepted: string[] = [];
    for (const id of ids) {
      const key = targetKey(target.type, id);
      if (!seen.has(key)) {
        accepted.push(id);
        seen.add(key);
      }
    }
    if (accepted.length > 0) normalized.push({ type: target.type, ids: accepted });
  }

  if (normalized.length === 0) throw validationError("Select at least one recipient target");
  if (normalized.some((target) => target.type === "EVERYONE") && normalized.length > 1) {
    throw validationError("Everyone must be the only recipient target");
  }
  return normalized;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assertTargetRole(auth: AuthContext, target: NoticeTargetKind) {
  if (target === "EVERYONE" || target === "TEACHER") {
    if (auth.role !== "ADMIN") throw forbidden("You cannot use this recipient target");
  }
  if (target === "ADMINS" && auth.role !== "TEACHER") {
    throw forbidden("You cannot use this recipient target");
  }
}

async function activeTeacherForAuth(auth: AuthContext) {
  if (auth.role !== "TEACHER") return null;
  const teacher = await prisma.teacher.findUnique({ where: { userId: auth.userId } });
  if (!teacher || !teacher.isActive) throw forbidden("Teacher profile not found");
  return teacher;
}

async function assertActiveViewerProfile(auth: AuthContext) {
  if (auth.role === "TEACHER") {
    await activeTeacherForAuth(auth);
  } else if (auth.role === "STUDENT") {
    const student = await prisma.student.findUnique({ where: { userId: auth.userId } });
    if (!student || !student.isActive) throw forbidden("Student profile not found");
  }
}

async function resolveTargets(auth: AuthContext, input: NoticeTargetInput[]): Promise<ResolvedTargets> {
  const targets = normalizeTargets(input);
  const teacher = await activeTeacherForAuth(auth);
  const rows: { targetType: NoticeTargetKind; targetId: string }[] = [];
  const recipientUserIds: string[] = [];
  let primaryCourseOfferingId: string | null = null;

  const idsForType = (type: NoticeTargetKind) => targets.filter((target) => target.type === type).flatMap((target) => target.ids);
  const offeringTargets = idsForType("COURSE_OFFERING");

  const offerings = offeringTargets.length
    ? await prisma.courseOffering.findMany({
        where: {
          id: { in: offeringTargets },
          isActive: true,
          academicYear: { isActive: true },
        },
        include: offeringInclude,
      })
    : [];
  if (offerings.length !== offeringTargets.length) {
    throw forbidden("One or more selected course offerings are unavailable to you");
  }

  if (teacher && offerings.length > 0) {
    const assignments = await prisma.teacherCourseAssignment.findMany({
      where: {
        teacherId: teacher.id,
        isActive: true,
        courseOfferingId: { in: offerings.map((offering) => offering.id) },
      },
      select: { courseOfferingId: true },
    });
    if (assignments.length !== offerings.length) {
      throw forbidden("You can only target course offerings assigned to you");
    }
  }

  for (const target of targets) {
    assertTargetRole(auth, target.type);
    if (target.type === "EVERYONE") {
      const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
      recipientUserIds.push(...users.map((user) => user.id));
      rows.push({ targetType: target.type, targetId: GROUP_TARGET_SENTINEL });
    } else if (target.type === "ADMINS") {
      const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
      recipientUserIds.push(...admins.map((admin) => admin.id));
      rows.push({ targetType: target.type, targetId: GROUP_TARGET_SENTINEL });
    } else if (target.type === "COURSE_OFFERING") {
      primaryCourseOfferingId ??= target.ids[0] ?? null;
      rows.push(...target.ids.map((id) => ({ targetType: target.type, targetId: id })));
      if (offerings.length > 0) {
        const enrollments = await prisma.studentEnrollment.findMany({
          where: {
            status: "ACTIVE",
            OR: offerings.map((offering) => contextWhere(offering)),
            student: { isActive: true, user: { isActive: true } },
          },
          select: { student: { select: { userId: true } } },
        });
        recipientUserIds.push(...enrollments.map((enrollment) => enrollment.student.userId));
      }
    } else if (target.type === "TEACHER") {
      const teachers = await prisma.teacher.findMany({
        where: {
          id: { in: target.ids },
          isActive: true,
          user: { isActive: true, role: "TEACHER" },
        },
        select: { id: true, userId: true },
      });
      if (teachers.length !== target.ids.length) throw forbidden("One or more selected teachers are unavailable");
      rows.push(...target.ids.map((id) => ({ targetType: target.type, targetId: id })));
      recipientUserIds.push(...teachers.map((teacherRow) => teacherRow.userId));
    } else if (target.type === "STUDENT") {
      const studentWhere: Prisma.StudentWhereInput = {
        id: { in: target.ids },
        isActive: true,
        user: { isActive: true, role: "STUDENT" },
      };
      if (teacher) {
        const assignedOfferings = await prisma.teacherCourseAssignment.findMany({
          where: { teacherId: teacher.id, isActive: true },
          include: { courseOffering: true },
        });
        if (assignedOfferings.length === 0) throw forbidden("You have no assigned course offerings");
        studentWhere.enrollments = {
          some: {
            status: "ACTIVE",
            OR: assignedOfferings.map((assignment) => contextWhere(assignment.courseOffering)),
          },
        };
      }
      const students = await prisma.student.findMany({ where: studentWhere, select: { id: true, userId: true } });
      if (students.length !== target.ids.length) throw forbidden("One or more selected students are not permitted");
      rows.push(...target.ids.map((id) => ({ targetType: target.type, targetId: id })));
      recipientUserIds.push(...students.map((student) => student.userId));
    }
  }

  return {
    rows,
    recipientUserIds: unique(recipientUserIds),
    primaryCourseOfferingId,
  };
}

function noticeVisibility(auth: AuthContext, id?: string): Prisma.NoticeWhereInput {
  const base: Prisma.NoticeWhereInput = { deletedAt: null };
  if (id) base.id = id;
  if (auth.role === "ADMIN") return base;
  if (auth.role === "TEACHER") {
    return {
      ...base,
      OR: [{ createdById: auth.userId }, { recipients: { some: { userId: auth.userId } } }],
    };
  }
  return { ...base, recipients: { some: { userId: auth.userId } } };
}

function canManageNotice(auth: AuthContext, createdById: string): boolean {
  return auth.role === "ADMIN" || createdById === auth.userId;
}

async function describeNoticeTargets(targets: { targetType: NoticeTargetKind; targetId: string }[]) {
  const offeringIds = targets.filter((target) => target.targetType === "COURSE_OFFERING").map((target) => target.targetId);
  const teacherIds = targets.filter((target) => target.targetType === "TEACHER").map((target) => target.targetId);
  const studentIds = targets.filter((target) => target.targetType === "STUDENT").map((target) => target.targetId);
  const [offerings, teachers, students] = await Promise.all([
    prisma.courseOffering.findMany({ where: { id: { in: offeringIds } }, include: offeringInclude }),
    prisma.teacher.findMany({ where: { id: { in: teacherIds } }, include: { user: { select: { name: true, email: true } } } }),
    prisma.student.findMany({ where: { id: { in: studentIds } }, include: { user: { select: { name: true, email: true } } } }),
  ]);
  const offeringById = new Map(offerings.map((offering) => [offering.id, offering]));
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const studentById = new Map(students.map((student) => [student.id, student]));

  return targets.map((target) => {
    if (target.targetType === "EVERYONE") return { ...target, label: "Everyone in the system" };
    if (target.targetType === "ADMINS") return { ...target, label: "All active admins" };
    if (target.targetType === "COURSE_OFFERING") {
      const offering = offeringById.get(target.targetId);
      return {
        ...target,
        label: offering ? `${offering.course.title} — ${offering.trade.code} · ${offering.semester.name} · ${offering.shift.name} · Sec ${offering.section.name} · ${offering.academicYear.name}` : "Selected course offering",
      };
    }
    if (target.targetType === "TEACHER") {
      const teacher = teacherById.get(target.targetId);
      return { ...target, label: teacher ? `${teacher.user.name} (${teacher.user.email})` : "Selected teacher" };
    }
    const student = studentById.get(target.targetId);
    return { ...target, label: student ? `${student.user.name} (${student.studentId})` : "Selected student" };
  });
}

function assertNoticeAuthor(auth: AuthContext) {
  if (auth.role !== "ADMIN" && auth.role !== "TEACHER") {
    throw forbidden("Only admins and teachers can manage notices");
  }
}

/**
 * The course offerings the author may address.
 *
 * Admins reach every active offering of an active academic year; teachers reach
 * only offerings they hold an ACTIVE assignment on. This is the single source of
 * the offering scope — both the recipient search and `resolveTargets` rely on
 * the same rule, so the picker can never offer something the write path rejects.
 */
function authorOfferingWhere(teacher: { id: string } | null): Prisma.CourseOfferingWhereInput {
  return {
    isActive: true,
    academicYear: { isActive: true },
    ...(teacher ? { assignments: { some: { teacherId: teacher.id, isActive: true } } } : {}),
  };
}

async function authorStudentWhere(teacher: { id: string } | null): Promise<Prisma.StudentWhereInput> {
  const base: Prisma.StudentWhereInput = { isActive: true, user: { isActive: true, role: "STUDENT" } };
  if (!teacher) return base;
  // A teacher may only address students enrolled in the academic context of an
  // offering they are actively assigned to.
  const offerings = await prisma.courseOffering.findMany({
    where: authorOfferingWhere(teacher),
    select: { academicYearId: true, tradeId: true, semesterId: true, shiftId: true, sectionId: true },
  });
  if (offerings.length === 0) return { id: { in: [] } };
  return {
    ...base,
    enrollments: { some: { status: "ACTIVE", OR: offerings.map((offering) => contextWhere(offering)) } },
  };
}

export type NoticeRecipientKind = "COURSE_OFFERING" | "TEACHER" | "STUDENT";

export interface NoticeRecipientOption {
  id: string;
  label: string;
  hint?: string;
}

function offeringLabel(offering: {
  course: { title: string };
  trade: { code: string };
  semester: { name: string };
  shift: { name: string };
  section: { name: string };
  academicYear: { name: string };
}): string {
  return `${offering.course.title} — ${offering.trade.code} · ${offering.semester.name} · ${offering.shift.name} · Sec ${offering.section.name} · ${offering.academicYear.name}`;
}

/**
 * One page of authorized recipient options matching `query`.
 *
 * Paginated on purpose: the previous implementation sent every student and every
 * offering in a single response, which the composer then rendered in full. The
 * authorization rules are unchanged — only the amount of data crossing the wire
 * is. Selected ids are still re-validated by `resolveTargets` on save, so a
 * client that ignores this endpoint gains nothing.
 */
export async function searchNoticeRecipients(opts: {
  auth: AuthContext;
  kind: NoticeRecipientKind;
  query?: string;
  page: number;
  limit: number;
}): Promise<{ items: NoticeRecipientOption[]; total: number }> {
  assertNoticeAuthor(opts.auth);
  const teacher = await activeTeacherForAuth(opts.auth);
  const search = opts.query?.trim() || undefined;
  const skip = (opts.page - 1) * opts.limit;

  if (opts.kind === "COURSE_OFFERING") {
    const where: Prisma.CourseOfferingWhereInput = authorOfferingWhere(teacher);
    if (search) {
      where.OR = [
        { course: { title: { contains: search, mode: "insensitive" } } },
        { course: { code: { contains: search, mode: "insensitive" } } },
        { section: { name: { contains: search, mode: "insensitive" } } },
        { trade: { name: { contains: search, mode: "insensitive" } } },
        { trade: { code: { contains: search, mode: "insensitive" } } },
        { semester: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    const [total, rows] = await prisma.$transaction([
      prisma.courseOffering.count({ where }),
      prisma.courseOffering.findMany({
        where,
        include: offeringInclude,
        orderBy: [{ academicYear: { startDate: "desc" } }, { course: { title: "asc" } }],
        skip,
        take: opts.limit,
      }),
    ]);
    return {
      total,
      items: rows.map((offering) => ({
        id: offering.id,
        label: offeringLabel(offering),
        hint: offering.course.code,
      })),
    };
  }

  if (opts.kind === "TEACHER") {
    // Only admins may address individual teachers (mirrors `assertTargetRole`).
    if (opts.auth.role !== "ADMIN") throw forbidden("You cannot use this recipient target");
    const where: Prisma.TeacherWhereInput = { isActive: true, user: { isActive: true, role: "TEACHER" } };
    if (search) {
      where.OR = [
        { employeeId: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ];
    }
    const [total, rows] = await prisma.$transaction([
      prisma.teacher.count({ where }),
      prisma.teacher.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
        skip,
        take: opts.limit,
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({ id: row.id, label: `${row.employeeId} — ${row.user.name}`, hint: row.user.email })),
    };
  }

  const where = await authorStudentWhere(teacher);
  if (search) {
    where.OR = [
      { studentId: { contains: search, mode: "insensitive" } },
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ];
  }
  const [total, rows] = await prisma.$transaction([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
      skip,
      take: opts.limit,
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({ id: row.id, label: `${row.studentId} — ${row.user.name}`, hint: row.user.email })),
  };
}

/**
 * What the author is allowed to target, and how many records each category
 * holds. Deliberately free of the option lists themselves — the composer loads
 * those page by page through `searchNoticeRecipients`.
 */
export async function listEligibleNoticeRecipients(auth: AuthContext) {
  assertNoticeAuthor(auth);
  const teacher = await activeTeacherForAuth(auth);
  const studentWhere = await authorStudentWhere(teacher);
  const [offeringCount, studentCount, teacherCount] = await Promise.all([
    prisma.courseOffering.count({ where: authorOfferingWhere(teacher) }),
    prisma.student.count({ where: studentWhere }),
    auth.role === "ADMIN"
      ? prisma.teacher.count({ where: { isActive: true, user: { isActive: true, role: "TEACHER" } } })
      : Promise.resolve(0),
  ]);

  return {
    canTargetEveryone: auth.role === "ADMIN",
    canTargetAdmins: auth.role === "TEACHER",
    canTargetTeachers: auth.role === "ADMIN",
    counts: { offerings: offeringCount, students: studentCount, teachers: teacherCount },
  };
}

/** Human labels for ids already attached to a notice (used when editing). */
export async function describeNoticeTargetIds(
  auth: AuthContext,
  targets: { targetType: NoticeTargetKind; targetId: string }[],
) {
  assertNoticeAuthor(auth);
  return describeNoticeTargets(targets);
}

export async function listNoticesForViewer(opts: {
  auth: AuthContext;
  courseOfferingId?: string;
  search?: string;
  page: number;
  limit: number;
}) {
  await assertActiveViewerProfile(opts.auth);
  const where: Prisma.NoticeWhereInput = noticeVisibility(opts.auth);
  const and: Prisma.NoticeWhereInput[] = [];
  if (opts.courseOfferingId) {
    and.push({
      OR: [
        { courseOfferingId: opts.courseOfferingId },
        { targets: { some: { targetType: "COURSE_OFFERING", targetId: opts.courseOfferingId } } },
      ],
    });
  }
  if (opts.search) {
    and.push({
      OR: [
        { title: { contains: opts.search, mode: "insensitive" } },
        { content: { contains: opts.search, mode: "insensitive" } },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const [total, items] = await prisma.$transaction([
    prisma.notice.count({ where }),
    prisma.notice.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        teacher: { include: { user: { select: { name: true, email: true } } } },
        courseOffering: { include: offeringInclude },
        targets: true,
        attachments: { include: { file: { select: { id: true, originalName: true, mimeType: true, size: true } } } },
        _count: { select: { recipients: true, notifications: true, attachments: true } },
      },
    }),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      canEdit: canManageNotice(opts.auth, item.createdById),
      canDelete: canManageNotice(opts.auth, item.createdById),
    })),
    total,
  };
}

export async function assertNoticeViewer(auth: AuthContext, id: string) {
  await assertActiveViewerProfile(auth);
  const notice = await prisma.notice.findFirst({ where: noticeVisibility(auth, id) });
  if (!notice) throw notFound("Notice not found");
  return notice;
}

export async function getNoticeForViewer(auth: AuthContext, id: string) {
  await assertActiveViewerProfile(auth);
  const notice = await prisma.notice.findFirst({
    where: noticeVisibility(auth, id),
    include: {
      createdBy: { select: { id: true, name: true, role: true } },
      teacher: { include: { user: { select: { name: true, email: true } } } },
      courseOffering: { include: offeringInclude },
      targets: true,
      attachments: { include: { file: { select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true } } } },
      recipients: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });
  if (!notice) throw notFound("Notice not found");

  const canSeeRecipientStatus = canManageNotice(auth, notice.createdById);
  const targetDetails = canSeeRecipientStatus ? await describeNoticeTargets(notice.targets) : undefined;
  const recipientStatuses = canSeeRecipientStatus
    ? await prisma.notification.findMany({
        where: {
          OR: [{ noticeId: id }, { resourceType: "Notice", resourceId: id }],
        },
        select: {
          id: true,
          recipientId: true,
          isRead: true,
          createdAt: true,
          deliveries: { select: { channel: true, status: true } },
        },
      })
    : [];
  const statusByUser = new Map(recipientStatuses.map((status) => [status.recipientId, status]));

  return {
    ...notice,
    canEdit: canManageNotice(auth, notice.createdById),
    canDelete: canManageNotice(auth, notice.createdById),
    targetDetails,
    recipients: canSeeRecipientStatus
      ? notice.recipients.map((recipient) => ({
          id: recipient.id,
          user: recipient.user,
          notification: statusByUser.get(recipient.userId) ?? null,
        }))
      : undefined,
  };
}

async function storeNoticeFiles(noticeId: string, files: NoticeFileUpload[]): Promise<StoredNoticeFile[]> {
  let validated: ValidatedNoticeAttachment[];
  try {
    validated = validateNoticeAttachmentBatch(files);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "Invalid attachment upload");
  }
  const stored: StoredNoticeFile[] = [];
  try {
    for (const file of validated) {
      const key = `notice-attachments/${noticeId}/${randomUUID()}.${file.extension}`;
      const result = await storage.put(file.buffer, { key, contentType: file.mimeType });
      stored.push({ key, bucket: result.bucket, validated: file });
    }
    return stored;
  } catch (error) {
    await Promise.allSettled(stored.map((file) => storage.remove(file.key)));
    throw error;
  }
}

async function cleanupStoredFiles(files: StoredNoticeFile[]) {
  for (const file of files) {
    try {
      await storage.remove(file.key);
    } catch (error) {
      logger.error("notice attachment object cleanup failed", { key: file.key, error: String(error) });
      enqueue(`notice-storage-cleanup:${file.key}`, async () => storage.remove(file.key));
    }
  }
}

async function removeStorageKeys(keys: string[]) {
  for (const key of keys) {
    try {
      await storage.remove(key);
    } catch (error) {
      logger.error("notice attachment object cleanup failed", { key, error: String(error) });
      enqueue(`notice-storage-cleanup:${key}`, async () => storage.remove(key));
    }
  }
}

function noticeNotificationInput(noticeId: string, title: string, content: string, recipientIds: string[]) {
  return {
    recipientIds,
    type: "NEW_NOTICE" as const,
    title: `New notice: ${title}`,
    message: content.slice(0, 200),
    resourceType: "Notice",
    resourceId: noticeId,
    noticeId,
  };
}

export async function createNotice(opts: {
  auth: AuthContext;
  input: NoticeWriteInput & { title: string; content: string; targets: NoticeTargetInput[] };
  files: NoticeFileUpload[];
}) {
  assertNoticeAuthor(opts.auth);
  const resolved = await resolveTargets(opts.auth, opts.input.targets);
  const creatorTeacher = await activeTeacherForAuth(opts.auth);
  const noticeId = randomUUID();
  const storedFiles = await storeNoticeFiles(noticeId, opts.files);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.notice.create({
        data: {
          id: noticeId,
          courseOfferingId: resolved.primaryCourseOfferingId,
          teacherId: creatorTeacher?.id ?? null,
          createdById: opts.auth.userId,
          title: opts.input.title,
          content: opts.input.content,
          expiresAt: opts.input.expiresAt ?? null,
        },
      });
      await tx.noticeTarget.createMany({
        data: resolved.rows.map((row) => ({ noticeId, targetType: row.targetType, targetId: row.targetId })),
      });
      await tx.noticeRecipient.createMany({
        data: resolved.recipientUserIds.map((userId) => ({ noticeId, userId })),
      });
      for (const stored of storedFiles) {
        const file = await tx.file.create({
          data: {
            originalName: stored.validated.originalName,
            mimeType: stored.validated.mimeType,
            size: stored.validated.size,
            storageKey: stored.key,
            bucket: stored.bucket,
            uploadedById: opts.auth.userId,
          },
        });
        await tx.noticeAttachment.create({ data: { noticeId, fileId: file.id } });
      }
      await notifyInTransaction(
        tx,
        noticeNotificationInput(noticeId, opts.input.title, opts.input.content, resolved.recipientUserIds),
      );
    });
  } catch (error) {
    await cleanupStoredFiles(storedFiles);
    throw error;
  }

  return { id: noticeId };
}

export async function updateNotice(opts: {
  auth: AuthContext;
  id: string;
  input: NoticeWriteInput;
  files: NoticeFileUpload[];
}) {
  assertNoticeAuthor(opts.auth);
  if (!Number.isInteger(opts.input.expectedVersion) || (opts.input.expectedVersion ?? 0) <= 0) throw validationError("Notice version is required; refresh before editing");
  const existing = await prisma.notice.findUnique({
    where: { id: opts.id },
    include: { attachments: { include: { file: true } }, recipients: { select: { userId: true } } },
  });
  if (!existing || existing.deletedAt) throw notFound("Notice not found");
  if (!canManageNotice(opts.auth, existing.createdById)) throw forbidden("You can only manage notices you created");

  const hasTargetUpdate = opts.input.targets !== undefined;
  const resolved = hasTargetUpdate ? await resolveTargets(opts.auth, opts.input.targets ?? []) : null;
  const removeIds = unique(opts.input.removeAttachmentIds ?? []);
  const existingAttachmentIds = new Set(existing.attachments.map((attachment) => attachment.id));
  if (removeIds.some((id) => !existingAttachmentIds.has(id))) throw notFound("Notice attachment not found");

  const retainedAttachments = existing.attachments.filter((attachment) => !removeIds.includes(attachment.id));
  const storedFiles = await storeNoticeFiles(opts.id, opts.files);
  const retainedBytes = retainedAttachments.reduce((sum, attachment) => sum + attachment.file.size, 0);
  const newBytes = storedFiles.reduce((sum, file) => sum + file.validated.size, 0);
  if (retainedAttachments.length + storedFiles.length > NOTICE_ATTACHMENT_MAX_COUNT) {
    await cleanupStoredFiles(storedFiles);
    throw validationError(`A notice can have at most ${NOTICE_ATTACHMENT_MAX_COUNT} files`);
  }
  if (retainedBytes + newBytes > NOTICE_ATTACHMENT_MAX_TOTAL_BYTES) {
    await cleanupStoredFiles(storedFiles);
    throw validationError("The combined attachment size must be 100 MB or smaller");
  }

  const oldRecipientIds = existing.recipients.map((recipient) => recipient.userId);
  const removedStorageKeys: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const where: Prisma.NoticeWhereInput = { id: opts.id, deletedAt: null };
      if (opts.input.expectedVersion !== undefined) where.version = opts.input.expectedVersion;
      const claimed = await tx.notice.updateMany({
        where,
        data: {
          ...(opts.input.title !== undefined ? { title: opts.input.title } : {}),
          ...(opts.input.content !== undefined ? { content: opts.input.content } : {}),
          ...(opts.input.expiresAt !== undefined ? { expiresAt: opts.input.expiresAt } : {}),
          ...(resolved ? { courseOfferingId: resolved.primaryCourseOfferingId } : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw conflict("This notice was changed by someone else. Refresh and try again.");

      if (resolved) {
        await tx.noticeTarget.deleteMany({ where: { noticeId: opts.id } });
        await tx.noticeTarget.createMany({
          data: resolved.rows.map((row) => ({ noticeId: opts.id, targetType: row.targetType, targetId: row.targetId })),
        });
        await tx.noticeRecipient.deleteMany({ where: { noticeId: opts.id } });
        await tx.noticeRecipient.createMany({
          data: resolved.recipientUserIds.map((userId) => ({ noticeId: opts.id, userId })),
        });

        const newRecipientIds = new Set(resolved.recipientUserIds);
        const removedRecipientIds = oldRecipientIds.filter((userId) => !newRecipientIds.has(userId));
        const addedRecipientIds = resolved.recipientUserIds.filter((userId) => !oldRecipientIds.includes(userId));
        if (removedRecipientIds.length > 0) {
          await tx.notification.deleteMany({
            where: {
              recipientId: { in: removedRecipientIds },
              OR: [
                { noticeId: opts.id },
                { resourceType: "Notice", resourceId: opts.id },
              ],
            },
          });
        }
        await notifyInTransaction(
          tx,
          noticeNotificationInput(opts.id, opts.input.title ?? existing.title, opts.input.content ?? existing.content, addedRecipientIds),
        );
      }

      if (removeIds.length > 0) {
        const removed = existing.attachments.filter((attachment) => removeIds.includes(attachment.id));
        await tx.noticeAttachment.deleteMany({ where: { id: { in: removeIds }, noticeId: opts.id } });
        for (const attachment of removed) {
          const otherNoticeReferences = await tx.noticeAttachment.count({ where: { fileId: attachment.fileId } });
          const submissionReferences = await tx.assessmentSubmission.count({ where: { fileId: attachment.fileId } });
          if (otherNoticeReferences === 0 && submissionReferences === 0) {
            await tx.file.delete({ where: { id: attachment.fileId } });
            removedStorageKeys.push(attachment.file.storageKey);
          }
        }
      }

      for (const stored of storedFiles) {
        const file = await tx.file.create({
          data: {
            originalName: stored.validated.originalName,
            mimeType: stored.validated.mimeType,
            size: stored.validated.size,
            storageKey: stored.key,
            bucket: stored.bucket,
            uploadedById: opts.auth.userId,
          },
        });
        await tx.noticeAttachment.create({ data: { noticeId: opts.id, fileId: file.id } });
      }
    });
  } catch (error) {
    await cleanupStoredFiles(storedFiles);
    throw error;
  }
  await removeStorageKeys(removedStorageKeys);
  return { id: opts.id };
}

export async function removeNoticeAttachment(opts: {
  auth: AuthContext;
  noticeId: string;
  attachmentId: string;
  expectedVersion: number;
}) {
  return updateNotice({
    auth: opts.auth,
    id: opts.noticeId,
    input: { expectedVersion: opts.expectedVersion, removeAttachmentIds: [opts.attachmentId] },
    files: [],
  });
}

export async function deleteNotice(opts: { auth: AuthContext; id: string; expectedVersion: number }) {
  assertNoticeAuthor(opts.auth);
  if (!Number.isInteger(opts.expectedVersion) || opts.expectedVersion <= 0) throw validationError("Notice version is required; refresh before deleting");
  const existing = await prisma.notice.findUnique({
    where: { id: opts.id },
    include: { attachments: { include: { file: true } } },
  });
  if (!existing || existing.deletedAt) throw notFound("Notice not found");
  if (!canManageNotice(opts.auth, existing.createdById)) throw forbidden("You can only manage notices you created");

  const removedStorageKeys: string[] = [];
  await prisma.$transaction(async (tx) => {
    const where: Prisma.NoticeWhereInput = { id: opts.id, deletedAt: null };
    if (opts.expectedVersion !== undefined) where.version = opts.expectedVersion;
    const claimed = await tx.notice.updateMany({
      where,
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (claimed.count !== 1) throw conflict("This notice was changed by someone else. Refresh and try again.");

    await tx.notification.deleteMany({
      where: {
        OR: [
          { noticeId: opts.id },
          { resourceType: "Notice", resourceId: opts.id },
        ],
      },
    });

    await tx.noticeAttachment.deleteMany({ where: { noticeId: opts.id } });
    for (const attachment of existing.attachments) {
      const otherNoticeReferences = await tx.noticeAttachment.count({ where: { fileId: attachment.fileId } });
      const submissionReferences = await tx.assessmentSubmission.count({ where: { fileId: attachment.fileId } });
      if (otherNoticeReferences === 0 && submissionReferences === 0) {
        await tx.file.delete({ where: { id: attachment.fileId } });
        removedStorageKeys.push(attachment.file.storageKey);
      }
    }
  });
  await removeStorageKeys(removedStorageKeys);
  return { deleted: true };
}

export async function getNoticeAttachmentDownloadUrl(auth: AuthContext, noticeId: string, attachmentId: string) {
  await assertNoticeViewer(auth, noticeId);
  const attachment = await prisma.noticeAttachment.findFirst({
    where: { id: attachmentId, noticeId },
    include: { file: { select: { originalName: true, mimeType: true, storageKey: true } } },
  });
  if (!attachment) throw notFound("Notice attachment not found");
  return {
    url: await storage.getSignedDownloadUrl(attachment.file.storageKey, "/api/v1/notices/files"),
    fileName: attachment.file.originalName,
    mimeType: attachment.file.mimeType,
  };
}

export async function getNoticeFileForDownload(auth: AuthContext, key: string) {
  const attachment = await prisma.noticeAttachment.findFirst({
    where: { file: { storageKey: key }, notice: { deletedAt: null } },
    include: { notice: true, file: true },
  });
  if (!attachment) throw notFound("File not found");
  await assertNoticeViewer(auth, attachment.noticeId);
  let buffer: Buffer;
  try {
    buffer = await storage.getBuffer(key);
  } catch {
    throw notFound("File not found");
  }
  return {
    buffer,
    fileName: attachment.file.originalName,
    mimeType: attachment.file.mimeType,
  };
}
