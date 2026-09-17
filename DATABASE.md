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
  it when enrolling or when creating a student (a student cannot exist without a roll number —
  `POST /api/v1/students` creates the initial enrollment atomically), and system-created
  enrollments (promotion/repetition) take the next free number in the destination section.
  `StudentEnrollment` is unique on (sectionId, rollNumber), so roll numbers cannot repeat in a
  section while remaining available across different sections.
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

The baseline migration `20260914000000_init` creates the full schema, so a brand-new
database is built with `npm run db:deploy` alone (6 migrations, applied in timestamp
order). The chain was replay-tested from an empty database and converges exactly on
`prisma/schema.prisma`.

For an existing database, back it up first, then inspect before changing anything:

```bash
npx prisma migrate status   # which migrations are recorded in _prisma_migrations?
```

* If `status` shows these migrations as pending and the tables were created from this
  schema (e.g. via `prisma db push` from an older revision), apply them with
  `npm run db:deploy` — the roll-number and `updateCount` migrations backfill existing
  rows before enforcing `NOT NULL`/uniqueness.
* If the database was created with `prisma db push` from the *current* schema (so the
  `_prisma_migrations` table is empty but every table/column already exists), do NOT
  `deploy` blindly: verify the schema matches, then baseline each migration with
  `prisma migrate resolve --applied "<migration_name>"` (all six, in order) so future
  `deploy` runs only apply new migrations. Never mark a migration applied unless its
  changes are already present.
* Never run `prisma migrate reset` on a database holding data you must keep, and never
  hand-edit `_prisma_migrations` rows.

On Neon (or any pooled Postgres), run all `prisma migrate` commands against the
**direct, unpooled** connection string: pooled connections cannot reliably hold the
advisory lock / transaction semantics migrations require. The runtime app may keep
using the pooled URL; only migration commands need the direct one.

`20260915000000_attendance_report_indexes` added a nullable `AttendanceChangeLog.attendanceSessionId`
column and `20260915120000_drop_attendance_change_log_session_id` drops it again (both use
`IF EXISTS`, so applying them in order is a no-op on a database that never had the column).

After any schema change the Prisma Client must be regenerated before the server reads or
writes the new field, otherwise Prisma rejects the query client-side with
`Unknown argument ...`. `npm run build` and `npm run dev` both regenerate it (`predev`);
run `npm run prisma:generate` by hand after editing `prisma/schema.prisma` in a long-lived
shell.
