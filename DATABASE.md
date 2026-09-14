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

## Curriculum rules (service-enforced, no schema change)

- Only **one active curriculum** per (trade, semester): creating/activating a curriculum
  deactivates the others of the same trade + semester in a transaction. Older versions
  stay archived as history.
- A `CourseOffering` may only reference a course that belongs to the **active curriculum**
  of its trade + semester (otherwise creation fails with `BUSINESS_RULE`).

## Migrations

```bash
docker compose up -d db
npx prisma migrate dev --name init
npm run db:seed            # admin + institution (+ demo data with SEED_DEMO=true)
```
