# EMS — Database

PostgreSQL + Prisma. Schema: `prisma/schema.prisma`. Historical academic data is permanent:
prefer archive/deactivate/close/version over destructive deletion; cascades are restricted
except where the child cannot exist without the parent (e.g. schedule items, submission's
session records).

## Migrations

Every schema change ships as a SQL migration under `prisma/migrations/`. **After pulling new
code, apply pending migrations before starting the app** — otherwise the running code queries
columns/tables the database does not have yet and API calls fail with
`The column 'X.y' does not exist in the current database`:

```bash
npx prisma migrate dev      # local development (may prompt, can create new migrations)
npx prisma migrate deploy   # staging / production (applies only, never prompts)
npx prisma migrate status   # check whether the database is behind
```

`npm run dev` performs this check automatically (`predev` →
`scripts/db-migration-check.mjs`): if the schema is out of sync the dev server refuses to
start and prints the remediation command instead of failing later with 500s per request.

Fresh local environment:

```bash
docker compose up -d db     # PostgreSQL 16 on localhost:5432 (see .env.example)
npm install                 # also generates the Prisma Client
npx prisma migrate deploy   # or: npm run db:deploy
npm run db:seed             # marks the protected seed admin; demo data requires SEED_DEMO=true
npm run dev
```

`npm run db:seed` is idempotent and promotes the account configured by
`SEED_ADMIN_EMAIL` to the protected seed admin (`User.isProtectedSeedAdmin`). Run it once
after deploying migration `20260918120000_protected_seed_admin_session_version`; the
migration itself never changes existing rows.

## Protected seed admin and session epoch (2026-09-18)

Migration `20260918120000_protected_seed_admin_session_version` adds two columns to
`User`:

- `isProtectedSeedAdmin BOOLEAN NOT NULL DEFAULT false` — the persisted identity of the
  single protected seed admin. Only `prisma/seed.ts` writes it; no API accepts it as
  input, so it cannot be granted or removed through the application. A partial unique
  index (`User_single_protected_seed_admin_key` … `WHERE "isProtectedSeedAdmin" = true`)
  lets the database itself guarantee that at most one protected account exists. The
  index is created in the migration because the Prisma DSL cannot express `WHERE`.
- `sessionVersion INTEGER NOT NULL DEFAULT 0` — the session epoch. Session tokens embed
  the value they were issued with; a password change or admin removal increments it, so
  tokens issued earlier stop validating without a session table.

No existing row is modified by the migration: the protection is applied by the seed
script, which is why a deployment that skips `db:seed` fails closed (nobody is treated
as the seed admin, and admin-management endpoints reject everyone).

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
AttendanceChangeLog, AttendanceChangeRequest, AttendanceChangeRequestItem, Assessment, AssessmentSubmission, AssessmentMark,
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

## Attendance correction and approval model (implemented)

Initial attendance creation is not a correction. `AttendanceSession.updateCount` is the
authoritative attendance-entry counter: one direct save that changes one or more students
increments it exactly once, and one approved request increments it exactly once. The configured
limit is `TEACHER_DIRECT_CORRECTIONS` (currently 2). Individual `AttendanceRecord.directCorrections`
values are legacy per-record history only and are never used to decide capacity.

Once the session counter reaches the limit, a teacher cannot save a direct correction and cannot
submit a request while capacity remains. A request is one operation for one session and contains
one normalized `AttendanceChangeRequestItem` per proposed student change. Each item stores the
record, old status and proposed status. A partial unique database index permits only one pending
request per session, including under concurrent submissions.

`AttendanceChangeLog` is append-only. It stores the operation ID, change type
(`INITIAL_ENTRY`, `DIRECT_CORRECTION`, or `APPROVED_REQUEST`) and associated request ID when
applicable. The history UI groups all student-level rows from one operation together.
Approval/rejection runs in one database transaction; approval revalidates every old status,
updates every record atomically, writes one log row per student, and increments the session once.
Rejected requests retain their complete proposed change set and reason.

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

Migration `20260918100000_attendance_entry_change_requests` safely copies the legacy
single-record request columns into `AttendanceChangeRequestItem`, backfills each request's
session, preserves the request rows and audit history, then enforces one pending request per
session. On an existing database deploy it after the earlier migrations; do not reset production
or delete old requests.

The baseline migration `20260914000000_init` creates the full schema, so a brand-new
database is built with `npm run db:deploy` alone (7 migrations, applied in timestamp
order). After deployment, run `npx prisma migrate status` and `npx prisma validate` to confirm the
local database and generated client match `prisma/schema.prisma`.

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

## Client generation & engine (never use `--no-engine` here)

This project connects to PostgreSQL directly, so the generated client must ship the real
query engine: `prisma generate` (no flags). `npm run prisma:generate` wraps it in
`scripts/prisma-generate.mjs`, which fails the build if the generated client would not be
able to reach PostgreSQL.

The trap that must not be reintroduced: `prisma generate --no-engine` (or
`PRISMA_GENERATE_NO_ENGINE=1`, `PRISMA_GENERATE_DATAPROXY=1`, `PRISMA_GENERATE_ACCELERATE=1`)
writes `"copyEngine": false` into `node_modules/.prisma/client/index.js`. Prisma 5 derives
the engine from that flag (`useDataProxy = isPrismaUrl || !copyEngine`) and therefore uses
its Accelerate/data-proxy engine, which only accepts a `prisma://` URL. The symptom is a
production-only failure on the first query — including the login/session lookup
(`prisma.user.findUnique` in `src/lib/auth/session.ts`):

```
Error validating datasource `db`: the URL must start with the protocol `prisma://`
```

Local `npm run dev` hides the problem because `predev` runs a plain `prisma generate`,
which overwrites the broken client. Nothing in this repository needs `--no-engine`, and no
build step may patch files inside `node_modules` to skip engine downloads: the runtime
needs `node_modules/.prisma/client/libquery_engine-<target>.so.node`, downloaded from
`https://binaries.prisma.sh` during generation (`@prisma/engines` uses the same host during
`npm install`). If a build host cannot reach it, point `PRISMA_ENGINES_MIRROR` at a mirror or
provide the binary via `PRISMA_QUERY_ENGINE_LIBRARY`, rather than generating without an
engine.

`postinstall` regenerates the client (best effort: it is skipped when devDependencies, and
therefore the Prisma CLI, are not installed). `npm run build` regenerates it strictly and
verifies it, so a production build always ships an engine-backed client.
