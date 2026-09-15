# EMS — Database

PostgreSQL + Prisma. Schema: `prisma/schema.prisma`. Historical academic data is permanent:
prefer archive/deactivate/close/version over destructive deletion; cascades are restricted
except where the child cannot exist without the parent (e.g. schedule items, submission's
session records).

## Core relationship chain

```
AcademicYear -> Trade -> Semester -> Shift -> Section -> Course -> CourseOffering
  -> Teacher (via active TeacherCourseAssignment)
  -> Students (derived via StudentEnrollment in the same context — never direct assignment)
  -> Attendance / Assessments / Submissions / Marks / Final grades
```

## Tables

User, Institution, AcademicYear, Trade, Semester, Shift, Section, Course, Curriculum,
CurriculumCourse, CourseOffering, Student, StudentEnrollment, StudentPromotion, Teacher,
TeacherCourseAssignment, ScheduleVersion, ScheduleItem, AttendanceSession, AttendanceRecord,
AttendanceChangeLog, AttendanceChangeRequest, Assessment, AssessmentSubmission, AssessmentMark,
AssessmentMarkChangeLog, AssessmentMarkChangeRequest, Notice, Notification, NotificationDelivery,
File, AuditLog.

## Important constraints

- `Course.code`, `Student.studentId` (permanent), `Teacher.employeeId` — unique.
- `StudentEnrollment.rollNumber` is required (no database default): the administrator supplies
  it when enrolling, and system-created enrollments (promotion/repetition) take the next free
  number in the destination section. `StudentEnrollment` is unique on (sectionId, rollNumber),
  so roll numbers cannot repeat in a section while remaining available across different sections.
- `CourseOffering` — unique on (academicYearId, tradeId, semesterId, shiftId, sectionId, courseId).
- `AttendanceSession` — unique on (courseOfferingId, attendanceDate).
- `AssessmentMark` — unique on (assessmentId, studentId).
- `AssessmentSubmission` — unique on (assessmentId, studentId).
- `TeacherCourseAssignment.activeSlot` — unique; enforces exactly one active teacher per offering.
- `Section` — unique on (academicYearId, tradeId, semesterId, shiftId, name); context immutable.
- Indexes on year/trade/semester/shift/section/offering/student/teacher/date/assessment/notification recipient+read state.

## Correction-counting rule (implemented)

Initial entry is not a correction. Teachers get 2 direct corrections per attendance record
and per mark; beyond that a `*ChangeRequest` (PENDING) requires admin approve/reject.
Approvals run in transactions (update + immutable log + request + audit).

The Attendance Report's per-session update count reads `AttendanceChangeLog` rows with
`oldStatus IS NOT NULL` and takes each row's session from its related record
(`AttendanceChangeLog.recordId -> AttendanceRecord.sessionId`). The session link is never
denormalized onto the log row: a nullable copy would have to be backfilled and would silently
count pre-existing rows as zero modifications.

## Curriculum rules (service-enforced, no schema change)

- Only **one active curriculum** per (trade, semester): creating/activating a curriculum
  deactivates the others of the same trade + semester in a transaction. Older versions
  stay archived as history.
- A `CourseOffering` may only reference a course that belongs to the **active curriculum**
  of its trade + semester (otherwise creation fails with `BUSINESS_RULE`).

## Migrations

The roll-number migrations first backfilled existing enrollments from a PostgreSQL sequence
and made `rollNumber` required, then removed the sequence/default so the value is always
admin-supplied, so existing data remains valid:

```bash
docker compose up -d db
npm run db:deploy
npm run db:seed            # admin + institution (+ demo data with SEED_DEMO=true)
```

For a brand-new database, apply the repository's baseline schema first (the repository
currently predates a committed initial migration), then run `npm run db:deploy`. Existing
installations should back up the database and apply
`20260914220000_add_roll_number_to_student_enrollments` followed by
`20260915090000_require_admin_supplied_roll_number` with Prisma migrate.

`20260915000000_attendance_report_indexes` added a nullable `AttendanceChangeLog.attendanceSessionId`
column and `20260915120000_drop_attendance_change_log_session_id` drops it again (both use
`IF EXISTS`, so applying them in order is a no-op on a database that never had the column).

After any schema change the Prisma Client must be regenerated before the server reads or
writes the new field, otherwise Prisma rejects the query client-side with
`Unknown argument ...`. `npm run build` and `npm run dev` both regenerate it (`predev`);
run `npm run prisma:generate` by hand after editing `prisma/schema.prisma` in a long-lived
shell.
