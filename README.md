EDUCATIONAL MANAGEMENT SYSTEM (EMS)
MASTER BUILD PROMPT FOR AN AI CODING AGENT
Version: 1.0

============================================================
0. ROLE AND PRIMARY OBJECTIVE
============================================================

You are a senior full-stack software architect and engineer.

Build a production-quality Educational Management System (EMS) for ONE institution/campus.

The application must include:

- backend
- frontend
- database
- authentication
- authorization
- REST API
- admin portal
- teacher portal
- student portal
- academic management
- student enrollment
- promotion/repetition
- teacher assignment/substitution
- schedules
- attendance
- assessments
- PDF assignment submissions
- marks and grading
- notices
- notifications
- reports
- audit logs
- testing
- production configuration

The application must be maintainable by both human developers and AI coding agents.

DO NOT build the entire application in one uncontrolled change.

Build incrementally in phases.

After each phase:
1. inspect existing implementation
2. implement only that phase
3. run typecheck
4. run lint
5. run relevant tests
6. run build when appropriate
7. fix failures
8. document important decisions
9. stop and wait for the next instruction

Never automatically proceed to the next phase.

============================================================
1. NON-NEGOTIABLE RULES
============================================================

1. NO MOCK DATA

Never use mock data for application functionality.

Do not use:
- hardcoded students
- fake teachers
- fake courses
- fake attendance
- fake marks
- fake schedules
- fake notices
- fake notifications
- fake dashboard statistics
- fake assessments
- fake promotion results
- fake API responses
- placeholder arrays pretending to be database data

Every application value must come from the real API/database.

If a UI page needs an API that does not exist:
- implement the API
- implement the service
- test it
- connect the UI to it

Do not work around missing backend functionality with mock data.

2. BACKEND IS AUTHORITATIVE

Frontend validation is for UX only.

Backend must enforce:
- authentication
- authorization
- business rules
- ownership
- resource relationships
- modification limits
- approval workflows
- file validation
- academic rules

Never trust IDs supplied by clients.

Protect against IDOR.

3. HISTORICAL DATA MUST BE PRESERVED

Never destroy important historical academic records.

Do not overwrite historical enrollment, teacher assignment, attendance, marks, promotion or audit information.

Prefer:
- archive
- deactivate
- close
- version
over destructive deletion.

4. BUSINESS LOGIC LOCATION

Do not put business logic in:
- React components
- page components
- route handlers

Use domain/application services.

Recommended flow:

UI
 -> API client
 -> REST API
 -> authentication/authorization
 -> domain/application service
 -> Prisma
 -> PostgreSQL

5. TRANSACTIONS

Use database transactions for:
- promotion
- teacher substitution
- attendance approvals
- mark approvals
- other multi-record integrity operations

6. DATABASE CONSTRAINTS

Important business invariants must be protected by database constraints whenever possible, not only application code.

7. API-FIRST

Every important UI operation must have a real API.

8. NO SILENT BUSINESS-RULE CHANGES

If requirements appear contradictory:
- identify the contradiction
- document it
- choose the safest interpretation only when necessary
- do not silently invent new rules

============================================================
2. TECHNOLOGY STACK
============================================================

Preferred stack:

Frontend/backend framework:
- Next.js
- React
- TypeScript

Database:
- PostgreSQL

ORM:
- Prisma

UI:
- Tailwind CSS
- shadcn/ui

Validation:
- Zod

Testing:
- Vitest
- Playwright
- integration/API testing

Storage:
- S3-compatible private object storage

API:
- REST
- versioned under /api/v1

Architecture:
- modular monolith

Do NOT introduce microservices unless there is a compelling documented reason.

Authentication may use a suitable mature solution such as Auth.js or Better Auth, depending on repository constraints.

============================================================
3. PROJECT STRUCTURE
============================================================

Prefer:

src/
  app/
    (auth)/
    (admin)/
    (teacher)/
    (student)/
    api/
  modules/
    academic/
    students/
    teachers/
    enrollments/
    promotions/
    course-offerings/
    attendance/
    assessments/
    submissions/
    marks/
    schedules/
    notices/
    notifications/
    reports/
    audit/
  lib/
    auth/
    db/
    permissions/
    storage/
    validation/
    notifications/
    errors/
    logging/
  components/
    ui/
    forms/
    tables/
    dialogs/
    navigation/
    charts/
  tests/
    unit/
    integration/
    e2e/

Adapt this to the existing repository if necessary, but preserve clear module boundaries.

============================================================
4. INSTITUTION MODEL
============================================================

There is ONE institution/campus.

Do not build multi-tenant functionality unless explicitly requested later.

Institution configuration must support:
- institution name
- logo/branding where appropriate
- contact information
- academic configuration

Semester count is configurable.

Shift count is configurable.

Do NOT hardcode:
- 8 semesters
- 2 shifts
- fixed section names

============================================================
5. ACADEMIC DOMAIN
============================================================

Core entities:

- Institution
- AcademicYear
- Trade
- Semester
- Shift
- Section
- Course
- Curriculum
- CurriculumCourse
- CourseOffering

------------------------------------------------------------
AcademicYear
------------------------------------------------------------

Examples:
- 2026-27
- 2027-28

Historical academic years remain available.

Do not hard-delete historical academic years.

------------------------------------------------------------
Trade
------------------------------------------------------------

Examples:
- Electronics
- Computer Science

A trade can have configurable semesters.

------------------------------------------------------------
Semester
------------------------------------------------------------

Semester count is institution-configurable.

Do not hardcode eight semesters.

------------------------------------------------------------
Shift
------------------------------------------------------------

Shift is institution-configurable.

Do not assume exactly two shifts.

------------------------------------------------------------
Section
------------------------------------------------------------

Section is only a division.

A section must belong to the appropriate:
- academic year
- trade
- semester
- shift

A section must not mix:
- different academic years
- different trades
- different semesters
- different shifts

------------------------------------------------------------
Course
------------------------------------------------------------

Course is a reusable academic subject.

Example:
- Digital Electronics
- Mathematics
- Programming Fundamentals

Course must have a unique code.

A Course is reusable across academic years.

Do not create duplicate Course records merely because a new academic year starts.

------------------------------------------------------------
Curriculum
------------------------------------------------------------

Curriculum maps:

Trade + Semester -> Courses

Use:
- Curriculum
- CurriculumCourse

If curriculum changes over time, preserve historical applicability rather than destroying history.

------------------------------------------------------------
CourseOffering
------------------------------------------------------------

CourseOffering is the actual class instance of a reusable Course.

It connects:
- academicYear
- trade
- semester
- shift
- section
- course

Use generated UUID/CUID database ID.

Do NOT use a concatenated string as the primary key.

Required unique constraint:

academicYearId + tradeId + semesterId + shiftId + sectionId + courseId

Students are NOT directly assigned to CourseOffering.

CourseOffering membership is derived from the student's relevant StudentEnrollment.

Teachers are assigned to CourseOfferings.

============================================================
6. STUDENT DOMAIN
============================================================

Entities:
- User
- Student
- StudentEnrollment
- StudentPromotion

Student:

- permanent studentId
- user account
- profile information
- active/inactive status as appropriate

studentId NEVER changes.

StudentEnrollment records academic placement.

Enrollment contains appropriate:
- student
- roll number (required, unique inside the section)
- academic year
- trade
- semester
- shift
- section
- status
- start/end dates if needed

A student cannot change section or shift during a semester.

The roll number is required on every enrollment and unique within its section
(sectionId + rollNumber). It is entered when enrolling a student; the API rejects duplicates
with a field error. System-created enrollments (promotion/repetition) take the next free
number in the destination section, and only a mistyped roll number may be corrected later
(admin-only, audit-logged).

Do not overwrite the current enrollment to promote a student.

Promotion creates a NEW enrollment.

Historical enrollment remains.

Possible enrollment/status values:
- ACTIVE
- PROMOTED
- FAILED
- REPEATING
- COMPLETED
- WITHDRAWN
- TRANSFERRED

Use enums only when the value set is truly stable; otherwise use configurable/reference data.

============================================================
7. TEACHER DOMAIN
============================================================

Entities:
- Teacher
- TeacherCourseAssignment

Teacher:
- employeeId unique
- user account
- status

Teacher assignment is to CourseOffering, not merely Course.

A teacher may teach the same Course in multiple CourseOfferings.

Exactly ONE active teacher may be assigned to a CourseOffering at a time.

Teacher authorization is resource-based.

Teacher may operate only on CourseOfferings where they have an ACTIVE assignment.

============================================================
8. TEACHER SUBSTITUTION
============================================================

Teacher substitution must:

1. close old active assignment
2. create replacement active assignment
3. preserve same CourseOffering
4. preserve attendance history
5. preserve mark history
6. preserve notices
7. preserve audit history
8. preserve original creator/teacher attribution

After substitution:
- old teacher cannot take attendance
- old teacher cannot enter marks
- old teacher cannot create new notices
- new teacher can

Historical records remain attributed to the original teacher.

Perform substitution transactionally.

Prevent concurrent operations from producing two active teachers.

============================================================
9. SCHEDULE DOMAIN
============================================================

Schedule belongs to CourseOffering.

Do NOT create teacher-specific schedules.

Use schedule versioning.

Suggested entities:
- ScheduleVersion
- ScheduleItem

ScheduleVersion:
- courseOfferingId
- effectiveFrom
- effectiveTo

ScheduleItem:
- weekday
- startTime
- endTime
- optional room/lab

When schedule changes:
- close previous version
- create new version
- preserve historical versions

Prevent overlapping effective schedule versions.

============================================================
10. ATTENDANCE
============================================================

Entities:
- AttendanceSession
- AttendanceRecord
- AttendanceChangeLog
- AttendanceChangeRequest

AttendanceSession unique:

courseOfferingId + attendanceDate

Exactly one attendance session per CourseOffering per date.

If session exists:
- edit it
- do not create another session

Statuses:
- PRESENT
- ABSENT
- LATE
- EXCUSED

Attendance applies to students who belong to the CourseOffering through enrollment.

------------------------------------------------------------
Teacher attendance rules
------------------------------------------------------------

Teacher may edit attendance only for CourseOfferings they currently teach.

Normal teacher edit window:
- attendance not more than one week old

Admin (product decision 2026-09-15 — overrides the earlier "may edit indefinitely"):
- READ-ONLY for attendance: admins never take attendance and never edit
  AttendanceRecord directly (POST /api/v1/attendance/sessions returns 403 for admins)
- admins may view attendance sessions, per-session student statuses and the
  immutable change history
- admins may approve or reject teacher change requests; approval is the ONLY
  mechanism through which an admin can cause an attendance change

Correction:
- mandatory reason

Every correction:
- immutable history record
- audit record where appropriate

------------------------------------------------------------
Missing historical session
------------------------------------------------------------

If no attendance session exists for an old date, an authorized teacher may create that missing session even though the normal edit window has passed.

This is different from editing an existing old session.

------------------------------------------------------------
Modification limit
------------------------------------------------------------

Interpretation for implementation:

- initial attendance entry is not counted as a correction
- teacher receives two direct corrections/modifications
- the next correction requires admin approval

If the existing repository/specification explicitly defines a different counting interpretation, stop and ask rather than silently changing the rule.

Use AttendanceChangeRequest:

- PENDING
- APPROVED
- REJECTED

Approval transaction:
- update attendance
- create change log
- update request
- create audit log

------------------------------------------------------------
Admin attendance report (UI)
------------------------------------------------------------

Primary entry point: /admin/attendance

Dependent filters (all options loaded from the backend, never hardcoded and
never constructed client-side):

  Academic Year -> Trade -> Semester -> Shift -> Section -> Course Offering

Semester is scoped to the selected Trade; a Section is identified by
academicYear + trade + semester + shift; Course Offerings are listed for the
selected section and context. Changing a parent clears every dependent
selection so a stale academic context can never be submitted.

After a Course Offering is chosen the page lists its AttendanceSessions:

- sorted by attendance date (server-side), paginated, date-range filterable
- each row shows date + weekday, Present/Absent/Late/Excused counts and the
  session's "Updated: N times" counter (one edit operation = one update;
  initial creation is not an update)
- actions: Student Status (complete section roster with a frontend Roll filter)
  and History (every change-log entry for that session, immutable)

Admin UI has no take/edit controls; the per-offering report at
/admin/course-offerings/{id}/attendance?tab=report remains available as a
read-only deep link. Teacher attendance (Take Attendance + Attendance Report)
lives under /teacher/course-offerings/{id}/attendance.

============================================================
11. ASSESSMENTS
============================================================

Entities:
- Assessment
- AssessmentSubmission
- AssessmentMark

Assessment belongs to CourseOffering.

Assessment types:
- ASSIGNMENT
- CLASS_TEST
- MIDTERM
- FINAL_EXAM
- PRACTICAL
- QUIZ
- OTHER

Assessment fields:
- title
- description
- type
- totalMarks
- passMarks
- submitable
- countsTowardFinal
- weight
- dueDate
- timestamps/status as appropriate

IMPORTANT:
There is NO "gradable" field.

Do not add one.

Submitable and grading are separate concepts.

Some assessments accept files.

Others only record marks.

============================================================
12. ASSIGNMENT SUBMISSION
============================================================

Submission format:
- PDF only

Maximum:
- 50 MB

Validate backend:
- authentication
- authorization
- student enrollment
- assessment membership
- submitable flag
- MIME type
- extension
- size

Do not trust browser validation.

Store files in private S3-compatible object storage.

Database stores file metadata.

Do not expose permanent public storage URLs.

Use secure access/signed URLs as appropriate.

============================================================
13. MARKS
============================================================

Entities:
- AssessmentMark
- AssessmentMarkChangeLog
- AssessmentMarkChangeRequest

One current mark per:
- assessmentId + studentId

Database unique constraint.

Teacher may enter marks only for currently assigned CourseOfferings.

Every mark modification requires:
- reason
- immutable history

Admin may modify indefinitely.

Teacher modification workflow:
- initial entry
- two direct modifications
- next modification requires approval

If repository/specification has an explicitly different interpretation, stop and clarify.

Approval:
- PENDING
- APPROVED
- REJECTED

Approval must be transactional.

============================================================
14. GRADING
============================================================

Create a dedicated GradingService.

Do not hardcode final-grade calculations inside UI components.

Support:
- totalMarks
- passMarks
- countsTowardFinal
- weight

The grading system must be designed so future grading rules can evolve.

The UI displays values returned/calculated by the backend grading service.

============================================================
15. PROMOTION
============================================================

Entities:
- StudentPromotion

Promotion must NEVER overwrite historical enrollment.

Promotion creates a new StudentEnrollment.

studentId remains unchanged.

Support:
- eligibility evaluation
- preview
- individual promotion
- bulk promotion
- repeat
- fail
- complete
- promotion history

Promotion workflow:

Admin
 -> select academic context
 -> evaluate students
 -> preview
 -> review
 -> choose result
 -> confirm
 -> transaction
 -> result summary

Prevent duplicate promotion operations.

Promotion must be transactional.

============================================================
16. NOTICES
============================================================

Notice belongs to CourseOffering and creating teacher.

Teacher may create notices only for currently assigned CourseOfferings.

Students in that CourseOffering can view notices.

After substitution:
- old teacher cannot create new notices
- old notices remain
- new teacher can create new notices

Suggested fields:
- courseOfferingId
- teacherId
- title
- content
- publishedAt
- expiresAt
- timestamps

============================================================
17. NOTIFICATIONS
============================================================

Channels:
- IN_APP
- EMAIL
- SMS

IMPORTANT:
NO PUSH NOTIFICATIONS.

Entities:
- Notification
- NotificationDelivery

Support:
- unread/read
- delivery status
- retries
- provider abstraction

Possible events:
- NEW_ASSIGNMENT
- ASSIGNMENT_DUE
- NEW_NOTICE
- MARK_PUBLISHED
- ATTENDANCE_UPDATE
- PENDING_APPROVAL
- PROMOTION_RESULT
- SYSTEM_NOTIFICATION

Email/SMS should be asynchronous.

Do not block normal user requests while sending them.

============================================================
18. AUDIT
============================================================

Create immutable AuditLog.

Suggested fields:
- actorUserId
- action
- entityType
- entityId
- oldValues
- newValues
- ip
- userAgent
- createdAt

Track:
- create
- update
- archive
- teacher substitution
- promotion
- attendance change
- attendance approval
- mark change
- mark approval

Never store passwords or secrets.

Attendance and marks retain their own domain-specific immutable histories in addition to general audit logs.

============================================================
19. DATABASE DESIGN
============================================================

Use PostgreSQL with Prisma.

Core models:

- User
- Institution
- AcademicYear
- Trade
- Semester
- Shift
- Section
- Course
- Curriculum
- CurriculumCourse
- CourseOffering
- Student
- StudentEnrollment
- StudentPromotion
- Teacher
- TeacherCourseAssignment
- ScheduleVersion
- ScheduleItem
- AttendanceSession
- AttendanceRecord
- AttendanceChangeLog
- AttendanceChangeRequest
- Assessment
- AssessmentSubmission
- AssessmentMark
- AssessmentMarkChangeLog
- AssessmentMarkChangeRequest
- Notice
- Notification
- NotificationDelivery
- File
- AuditLog

Add timestamps to mutable entities.

Use:
- primary keys
- foreign keys
- unique constraints
- indexes
- check constraints where Prisma/PostgreSQL support is appropriate

Important unique constraints:

Course:
- code

Student:
- studentId

Teacher:
- employeeId

CourseOffering:
- academicYearId
- tradeId
- semesterId
- shiftId
- sectionId
- courseId

AttendanceSession:
- courseOfferingId
- attendanceDate

AssessmentMark:
- assessmentId
- studentId

Prevent duplicate active teacher assignments.

Index common filters:
- academicYear
- trade
- semester
- shift
- section
- courseOffering
- student
- teacher
- attendanceDate
- assessment
- notification recipient/read state

Never add redundant relationships just for convenience if they can produce inconsistent data.

============================================================
20. AUTHENTICATION
============================================================

Roles:
- ADMIN
- TEACHER
- STUDENT

Admin:
- institution-wide access

Teacher:
- assigned CourseOffering access

Student:
- own data only

Every protected API endpoint must enforce authorization.

Examples:

Teacher requests:
GET /api/v1/course-offerings/{id}

Server must verify active TeacherCourseAssignment.

Student requests:
GET /api/v1/students/{id}

Server must verify that id belongs to authenticated student.

Never trust:
- URL IDs
- query IDs
- body IDs

============================================================
21. REST API
============================================================

API base:

/api/v1

Use plural resource names.

Recommended resources:

/api/v1/auth
/api/v1/users
/api/v1/institution
/api/v1/academic-years
/api/v1/trades
/api/v1/semesters
/api/v1/shifts
/api/v1/sections
/api/v1/courses
/api/v1/curricula
/api/v1/course-offerings
/api/v1/students
/api/v1/enrollments
/api/v1/promotions
/api/v1/teachers
/api/v1/teacher-assignments
/api/v1/schedules
/api/v1/attendance
/api/v1/assessments
/api/v1/submissions
/api/v1/marks
/api/v1/notices
/api/v1/notifications
/api/v1/reports
/api/v1/audit-logs

Nested routes may be used when the relationship is strongly resource-oriented.

Examples:

GET /api/v1/course-offerings/{courseOfferingId}/students

GET /api/v1/course-offerings/{courseOfferingId}/attendance

GET /api/v1/course-offerings/{courseOfferingId}/assessments

GET /api/v1/course-offerings/{courseOfferingId}/marks

GET /api/v1/students/{studentId}/attendance

GET /api/v1/students/{studentId}/marks

Do not create excessively deep nested URLs.

============================================================
22. HTTP METHODS
============================================================

Use conventional methods:

GET:
- retrieve

POST:
- create/action where appropriate

PATCH:
- partial update

DELETE:
- only where safe and explicitly appropriate

For historical academic records, prefer archive/deactivate endpoints.

Example:

POST /api/v1/course-offerings

PATCH /api/v1/course-offerings/{id}

POST /api/v1/teacher-assignments

POST /api/v1/teacher-assignments/{id}/substitute

POST /api/v1/promotions/preview

POST /api/v1/promotions/execute

POST /api/v1/attendance/sessions

PATCH /api/v1/attendance/records/{id}

POST /api/v1/attendance/change-requests

POST /api/v1/attendance/change-requests/{id}/approve

POST /api/v1/attendance/change-requests/{id}/reject

POST /api/v1/marks/change-requests

POST /api/v1/marks/change-requests/{id}/approve

============================================================
23. API RESPONSE FORMAT
============================================================

Use a consistent response format.

Success example:

{
  "data": {},
  "meta": {}
}

Error example:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this resource",
    "details": {}
  }
}

Do not expose:
- stack traces
- SQL errors
- secrets
- internal implementation details

Use correct HTTP status codes.

============================================================
24. PAGINATION
============================================================

Large collections must be paginated.

Support:
- page/limit OR cursor pagination

Choose one consistent strategy.

Do not load thousands of students into the browser.

API should return pagination metadata.

============================================================
25. FILTERING AND SORTING
============================================================

Use query parameters.

Example:

GET /api/v1/students?academicYearId=...&tradeId=...&semesterId=...&sectionId=...&search=rahim&page=1&limit=25

Use consistent parameter names.

Never create inconsistent filtering conventions across modules.

============================================================
26. API VALIDATION
============================================================

Validate all incoming data with Zod or equivalent server-side validation.

Validate:
- body
- query
- params
- file metadata

Never rely on frontend validation.

============================================================
27. FRONTEND APPLICATION
============================================================

Create role-specific layouts.

Admin:
 /admin/*

Teacher:
 /teacher/*

Student:
 /student/*

Authentication:
 /login

Use:
- sidebar
- header
- breadcrumbs
- page headers
- cards
- tables
- forms
- dialogs
- tabs
- charts
- notifications

The UI must be:
- colorful
- modern
- intuitive
- professional
- responsive
- accessible

Avoid excessive decoration.

Use semantic status colors consistently.

============================================================
28. GLOBAL UI
============================================================

Authenticated layout:

Header:
- page/context
- search where useful
- notifications
- profile menu

Sidebar:
role-specific navigation

Use responsive navigation on mobile.

Common reusable components:

- PageHeader
- PageContainer
- DataTable
- FilterBar
- SearchInput
- EmptyState
- ErrorState
- LoadingSkeleton
- ConfirmDialog
- FormDialog
- StatusBadge
- AttendanceBadge
- ApprovalBadge
- StatCard
- ChartCard
- Breadcrumbs
- Tabs
- Pagination
- DatePicker
- SelectField
- AsyncSelect

============================================================
29. ADMIN NAVIGATION
============================================================

/admin/dashboard

Academic:
 /admin/academic-years
 /admin/trades
 /admin/semesters
 /admin/shifts
 /admin/sections
 /admin/courses
 /admin/curricula
 /admin/course-offerings

People:
 /admin/students
 /admin/teachers

Operations:
 /admin/enrollments
 /admin/promotions
 /admin/attendance
 /admin/attendance/approvals
 /admin/assessments
 /admin/marks
 /admin/marks/approvals
 /admin/schedules
 /admin/notices

Communication:
 /admin/notifications

Reports:
 /admin/reports
 /admin/reports/attendance
 /admin/reports/marks
 /admin/reports/students/{studentId}

Administration:
 /admin/audit-logs
 /admin/settings

============================================================
30. TEACHER NAVIGATION
============================================================

/teacher/dashboard
/teacher/course-offerings
/teacher/schedule
/teacher/notices
/teacher/notifications

CourseOffering operational routes:

/teacher/course-offerings/{id}
/teacher/course-offerings/{id}/students
/teacher/course-offerings/{id}/attendance
/teacher/course-offerings/{id}/assessments
/teacher/course-offerings/{id}/marks
/teacher/course-offerings/{id}/schedule
/teacher/course-offerings/{id}/notices

============================================================
31. STUDENT NAVIGATION
============================================================

/student/dashboard
/student/courses
/student/schedule
/student/attendance
/student/assessments
/student/marks
/student/notices
/student/notifications

Individual resources:

/student/assessments/{id}
/student/attendance/{courseOfferingId}
/student/marks/{assessmentId}

Student only sees own data.

============================================================
32. ADMIN PAGE WORKFLOW
============================================================

ADMIN DASHBOARD

Display real API data:
- total students
- active teachers
- current academic year
- active sections
- active CourseOfferings
- today's attendance
- pending attendance approvals
- pending mark approvals
- recent activity

Never invent numbers.

------------------------------------------------------------
Academic Year
------------------------------------------------------------

List:
- search
- filters
- create
- edit
- archive
- detail

Detail:
- overview
- trades
- related academic structures

------------------------------------------------------------
Trade
------------------------------------------------------------

Detail tabs:
- Overview
- Semesters
- Curriculum
- Sections
- Students
- Course Offerings

------------------------------------------------------------
Semester
------------------------------------------------------------

Dynamic institution configuration.

Never assume eight semesters.

------------------------------------------------------------
Shift
------------------------------------------------------------

Dynamic institution configuration.

Never assume two shifts.

------------------------------------------------------------
Section
------------------------------------------------------------

Filters:
- academic year
- trade
- semester
- shift

Detail tabs:
- Overview
- Students
- Courses
- Course Offerings
- Schedule
- Attendance

------------------------------------------------------------
Course
------------------------------------------------------------

Detail tabs:
- Overview
- Curriculum Usage
- Course Offerings
- Teachers

------------------------------------------------------------
Curriculum
------------------------------------------------------------

Detail:
- trade
- semester
- courses

Actions:
- add course
- remove course
- reorder where supported
- version/archive where supported

------------------------------------------------------------
CourseOffering
------------------------------------------------------------

Central operational page.

Show:
- academic year
- trade
- semester
- shift
- section
- course
- current teacher
- students
- schedule

Tabs:
- Overview
- Students
- Teacher
- Schedule
- Attendance
- Assessments
- Marks
- Notices

============================================================
33. STUDENT ADMIN WORKFLOW
============================================================

/admin/students

Features:
- search
- filters
- pagination
- create
- edit
- detail

Search:
- student ID
- name
- email

Filters:
- academic year
- trade
- semester
- shift
- section
- status

Student detail:

/admin/students/{id}

Tabs:
- Overview
- Enrollments
- Courses
- Attendance
- Assessments
- Marks
- Schedule
- Notices
- Promotion History

Show current enrollment separately from historical enrollment.

============================================================
34. ENROLLMENT WORKFLOW
============================================================

/admin/enrollments

Show:
- student
- student ID
- roll number
- academic year
- trade
- semester
- shift
- section
- status

Roll number is required when enrolling a student and must be unique inside the selected
section. The form prefills the next available number for the section, the API rejects a
duplicate with an inline field error, and a mistyped number can be corrected (audit-logged).

Preserve historical enrollment.

Do not provide unsafe "change current enrollment" functionality that destroys history.

============================================================
35. PROMOTION UI
============================================================

/admin/promotions

Workflow:

Select:
- academic year
- trade
- semester
- shift/section where appropriate

Then:
- load students
- evaluate eligibility
- preview

Preview table:
- student
- current semester
- current result
- destination
- reason/status

Actions:
- promote
- repeat
- fail
- complete

Require confirmation.

Call real promotion APIs.

Show result summary after transaction.

============================================================
36. TEACHER ADMIN WORKFLOW
============================================================

/admin/teachers

List:
- employee ID
- name
- email
- status
- active CourseOfferings

Teacher detail:

/admin/teachers/{id}

Tabs:
- Overview
- Course Offerings
- Assignments
- Assignment History

Teacher assignments:

/admin/teacher-assignments

Display:
- CourseOffering
- Course
- Section
- current teacher
- status

Substitution UI:
- current teacher
- replacement teacher
- effective date
- reason

Show consequences before confirmation.

============================================================
37. TEACHER DASHBOARD
============================================================

/teacher/dashboard

Show real API data:

- teacher name
- today's classes
- attendance tasks
- upcoming assessments
- pending mark work
- recent notices

Only current assignments.

============================================================
38. TEACHER COURSE OFFERING WORKFLOW
============================================================

/teacher/course-offerings

Display each current CourseOffering.

Card/table:
- course
- section
- semester
- shift
- students
- next class
- attendance status

Detail:

/teacher/course-offerings/{id}

Tabs:
- Overview
- Students
- Attendance
- Assessments
- Marks
- Schedule
- Notices

Backend verifies active assignment.

============================================================
39. TEACHER ATTENDANCE WORKFLOW
============================================================

/teacher/course-offerings/{id}/attendance

Prioritize speed.

Header:
- course
- section
- date

Controls:
- previous day
- today
- next day

Summary:
- present
- absent
- late
- excused

Table:
- student ID
- student name
- status
- note/reason where supported

Actions:
- mark all present
- individual status changes
- save

Attendance save must use real API.

Do not locally pretend save succeeded.

============================================================
40. ATTENDANCE CORRECTION UI
============================================================

When modifying:

Show:
- current status
- new status
- reason required
- direct corrections remaining

When approval required:
show clearly:

"Admin approval required"

Submit a real change request.

============================================================
41. ATTENDANCE HISTORY
============================================================

Show timeline/table:

- date
- student
- old status
- new status
- changed by
- reason
- timestamp

Use real backend history.

============================================================
42. ADMIN ATTENDANCE APPROVAL
============================================================

/admin/attendance/approvals

Show:
- teacher
- course
- section
- student
- old status
- new status
- reason
- request date
- status

Actions:
- approve
- reject
- inspect history

============================================================
43. ASSESSMENT WORKFLOW
============================================================

Teacher:

/teacher/course-offerings/{id}/assessments

List:
- title
- type
- due date
- total marks
- pass marks
- submitable
- counts toward final
- weight
- status

Create:

- title
- description
- type
- total marks
- pass marks
- submitable
- countsTowardFinal
- weight
- dueDate

No "gradable" field.

============================================================
44. STUDENT ASSESSMENT WORKFLOW
============================================================

/student/assessments

Categories:
- upcoming
- submitted
- past due
- graded

Each item:
- course
- assessment
- due date
- total marks
- submission status
- mark

Detail:
- instructions
- due date
- submission
- result

============================================================
45. SUBMISSION WORKFLOW
============================================================

If submitable:

Upload:
- PDF only
- max 50 MB

Flow:

select file
 -> frontend basic validation
 -> API
 -> backend validation
 -> private storage
 -> database metadata
 -> submission response
 -> refresh UI

Show real upload state.

Never fake successful submission.

============================================================
46. MARK ENTRY WORKFLOW
============================================================

/teacher/course-offerings/{id}/marks

Display:
- assessment
- total marks
- students
- current marks

Teacher can enter/update authorized marks.

Show:
- history
- remaining direct corrections
- approval requirement

Every correction requires reason.

============================================================
47. MARK APPROVAL
============================================================

/admin/marks/approvals

Display:
- teacher
- student
- assessment
- old mark
- new mark
- reason
- requested time
- status

Actions:
- approve
- reject
- history

Use real transactional API.

============================================================
48. SCHEDULE UI
============================================================

Admin:

/admin/schedules

Filters:
- academic year
- trade
- semester
- shift
- section

Weekly calendar.

Teacher:

/teacher/schedule

Show current teacher's CourseOffering schedules.

Student:

/student/schedule

Show schedules for student's current courses.

Schedule belongs to CourseOffering, not teacher.

============================================================
49. NOTICE UI
============================================================

Admin:
/admin/notices

Teacher:
/teacher/notices

Student:
/student/notices

Teacher target selection must be restricted to CourseOfferings currently taught by that teacher.

Notice:
- title
- content
- publish date
- expiry date

Student sees notices for their relevant CourseOfferings.

============================================================
50. NOTIFICATION UI
============================================================

Global notification icon.

Page:
/notifications

or role-specific notification route.

Tabs:
- unread
- all

Each:
- icon
- title
- message
- timestamp
- read state

Click can navigate to relevant resource.

No push notifications.

============================================================
51. STUDENT DASHBOARD
============================================================

/student/dashboard

Show:
- real student name
- current academic context
- attendance overview
- upcoming assessments
- recent marks
- today's schedule
- recent notices
- notifications

Attendance:
- percentage
- present
- absent
- late

All data from APIs.

============================================================
52. STUDENT ATTENDANCE
============================================================

/student/attendance

Show:
- course
- total classes
- present
- absent
- late
- excused
- percentage

Filters:
- course
- date range

Detailed course attendance should use real backend data.

============================================================
53. STUDENT MARKS
============================================================

/student/marks

Show:
- course
- assessment
- marks
- total
- percentage
- grade

Student can only see own marks.

============================================================
54. REPORTS
============================================================

/admin/reports

Categories:
- attendance
- students
- marks

------------------------------------------------------------
Attendance report
------------------------------------------------------------

/admin/reports/attendance

Filters:
- academic year
- trade
- semester
- shift
- section
- course
- month/date range

Results:
- student ID
- name
- total classes
- present
- absent
- late
- excused
- percentage

Use server-side aggregation.

------------------------------------------------------------
Individual student report
------------------------------------------------------------

/admin/reports/students/{studentId}

Show:
- student information
- current enrollment
- enrollment history
- attendance by course
- assessment marks
- final grades
- promotion history

------------------------------------------------------------
Marks report
------------------------------------------------------------

/admin/reports/marks

Filters:
- academic year
- trade
- semester
- shift
- section
- course
- assessment

Results:
- student
- assessment
- mark
- total
- percentage
- pass/fail
- final grade

============================================================
55. AUDIT UI
============================================================

/admin/audit-logs

Filters:
- actor
- action
- entity
- date range

Columns:
- date
- actor
- action
- entity
- entity ID
- summary

Detail:
- old values
- new values
- IP
- user agent
- timestamp

Never expose secrets.

============================================================
56. SETTINGS UI
============================================================

/admin/settings

Sections:
- Institution
- Academic Configuration
- Notification Configuration
- System Configuration

Semester and shift configuration must be dynamic.

============================================================
57. UI STATE REQUIREMENTS
============================================================

Every data-driven page must implement:

1. loading
2. success
3. empty
4. error

Never show blank screens during loading.

Use:
- skeletons
- loading indicators
- empty states
- retry actions

============================================================
58. FORM REQUIREMENTS
============================================================

Every form:
- labels
- required indicators
- helper text
- validation
- inline errors
- loading state
- disabled submit while saving
- success feedback
- failure feedback

Frontend validation:
- Zod where appropriate

Backend validation:
- mandatory

============================================================
59. TABLE REQUIREMENTS
============================================================

Major tables:
- search
- filters
- pagination
- sorting where useful
- responsive behavior
- loading skeleton
- empty state
- error state

Use server-side pagination.

============================================================
60. RESPONSIVE DESIGN
============================================================

Desktop:
- sidebar
- tables
- dashboard cards
- charts

Tablet:
- adaptive layouts

Mobile:
- responsive sidebar/navigation
- stacked cards
- mobile-friendly forms
- horizontal scrolling for wide tables
- touch-friendly controls

Attendance must be especially usable on mobile.

============================================================
61. ACCESSIBILITY
============================================================

Use:
- semantic HTML
- keyboard navigation
- focus states
- accessible dialogs
- labels
- ARIA only where needed
- sufficient contrast

Do not communicate important information only through color.

============================================================
62. API CLIENT
============================================================

Create centralized API clients.

Example:

src/lib/api/

- authApi
- academicApi
- studentApi
- teacherApi
- courseOfferingApi
- attendanceApi
- assessmentApi
- submissionApi
- marksApi
- scheduleApi
- noticeApi
- notificationApi
- promotionApi
- reportApi
- auditApi

Do not scatter raw fetch calls everywhere.

============================================================
63. DATA FETCHING
============================================================

Use one consistent data-fetching approach.

Each query:
- handles loading
- handles errors
- handles empty results
- caches where useful

After mutation:
- use server response
- invalidate/refetch affected queries
- do not invent local server state

============================================================
64. UI AUTHORIZATION
============================================================

Hide actions the user cannot perform.

But remember:

UI hiding is NOT security.

Backend must still reject unauthorized requests.

Example:
Teacher does not see another teacher's CourseOffering.

If teacher manually calls its API:
- backend returns 403

============================================================
65. URL FORMAT
============================================================

Use kebab-case resource names.

Examples:

/admin/academic-years
/admin/course-offerings
/admin/teacher-assignments
/admin/audit-logs

Resource IDs:

/admin/students/{id}
/admin/course-offerings/{id}
/admin/teachers/{id}

Nested operational resources:

/teacher/course-offerings/{id}/attendance
/teacher/course-offerings/{id}/assessments
/teacher/course-offerings/{id}/marks

Avoid IDs in human-readable display where unnecessary.

============================================================
66. BREADCRUMBS
============================================================

Use breadcrumbs for deep pages.

Example:

Admin
 > Course Offerings
 > Digital Electronics
 > Section A

Use actual relationships.

============================================================
67. PAGE RELATIONSHIPS
============================================================

Core academic relationship:

Academic Year
 -> Trade
 -> Semester
 -> Shift
 -> Section
 -> Course
 -> CourseOffering
 -> Teacher
 -> Students
 -> Attendance
 -> Assessments
 -> Submissions
 -> Marks
 -> Final Grades

Admin workflow:

Dashboard
 -> Academic structure
 -> Courses/Curriculum
 -> CourseOfferings
 -> Teachers/Students
 -> Operations
 -> Reports/Audit

Teacher workflow:

Dashboard
 -> My CourseOfferings
 -> Students
 -> Attendance
 -> Assessments
 -> Marks
 -> Notices

Student workflow:

Dashboard
 -> Current academic context
 -> Courses
 -> Schedule
 -> Attendance
 -> Assessments
 -> Submissions
 -> Marks
 -> Notices

============================================================
68. DEPENDENT FILTERS
============================================================

Filters should cascade.

Example:

Academic Year
 -> Trade
 -> Semester
 -> Shift
 -> Section
 -> Course

Use actual API data.

Do not hardcode dependent values.

Reset dependent selections when parent filters change.

============================================================
69. DASHBOARD DATA
============================================================

Dashboard statistics must come from backend aggregation APIs or queries.

Never calculate large statistics from an incomplete client dataset.

Example:
Today's attendance percentage should be computed from authoritative attendance data.

============================================================
70. FILE SECURITY
============================================================

Private files.

Never expose:
- S3 credentials
- storage secret
- unrestricted bucket

Backend must authorize file access.

Validate upload:
- extension
- MIME
- size
- assessment
- student
- submitable flag

============================================================
71. SECURITY
============================================================

Perform protection against:

- IDOR
- broken access control
- privilege escalation
- mass assignment
- SQL injection
- XSS
- CSRF where applicable
- unsafe file upload
- insecure direct object references
- leaked secrets
- excessive data exposure
- race conditions

Use secure headers/configuration appropriate to framework.

Use rate limiting where appropriate.

============================================================
72. CONCURRENCY
============================================================

Protect against races in:

- teacher substitution
- active teacher assignment
- attendance session creation
- attendance approval
- attendance modification limits
- mark modification limits
- mark approval
- promotion
- enrollment creation
- CourseOffering creation
- schedule versioning

Use:
- unique constraints
- transactions
- locking/isolation where necessary
- optimistic concurrency where appropriate

============================================================
73. TESTING
============================================================

Unit tests:
- services
- validators
- grading
- authorization rules

Integration tests:
- API
- database constraints
- workflows

E2E tests:

Authentication:
- login
- logout
- unauthorized route

Admin:
- academic setup
- course/curriculum
- CourseOffering
- student
- teacher
- assignment
- substitution
- promotion
- reports

Teacher:
- assigned CourseOffering
- attendance
- attendance correction
- assessment
- marks
- notices

Student:
- dashboard
- own attendance
- own assessments
- PDF submission
- own marks
- schedule
- notices

============================================================
74. CRITICAL E2E WORKFLOWS
============================================================

Workflow 1:

Admin creates:
Academic Year
 -> Trade
 -> Semester
 -> Shift
 -> Section
 -> Course
 -> Curriculum
 -> CourseOffering

Workflow 2:

Admin creates Student
 -> Enrollment
 -> Student login
 -> Student sees correct courses

Workflow 3:

Admin creates Teacher
 -> Assigns CourseOffering
 -> Teacher login
 -> sees CourseOffering

Workflow 4:

Teacher:
 -> opens attendance
 -> marks students
 -> saves
 -> history exists

Workflow 5:

Teacher:
 -> exceeds correction limit
 -> approval required
 -> admin approves
 -> attendance changes
 -> history exists

Workflow 6:

Teacher:
 -> creates assessment
 -> student sees assessment
 -> student submits PDF
 -> teacher sees submission
 -> teacher enters mark

Workflow 7:

Teacher:
 -> exceeds mark correction limit
 -> approval required
 -> admin approves
 -> mark changes
 -> history exists

Workflow 8:

Admin:
 -> substitutes teacher
 -> old teacher loses access
 -> new teacher gains access
 -> historical records preserved

Workflow 9:

Admin:
 -> promotes student
 -> old enrollment remains
 -> new enrollment created
 -> studentId unchanged

Workflow 10:

Student A:
 -> attempts Student B's API resource
 -> receives 403/appropriate denial

Workflow 11:

Teacher A:
 -> attempts Teacher B's CourseOffering
 -> receives 403

============================================================
75. ERROR HANDLING
============================================================

Standardize errors.

401:
- unauthenticated

403:
- authenticated but unauthorized

404:
- resource not found

409:
- conflict/duplicate/business-state conflict

422:
- validation error where appropriate

500:
- safe generic server error

Never expose internal details.

============================================================
76. LOGGING
============================================================

Implement structured application logging.

Do not log:
- passwords
- tokens
- secrets
- sensitive unnecessary payloads

Use request IDs/correlation IDs where useful.

============================================================
77. BACKGROUND JOBS
============================================================

Email/SMS should be asynchronous.

Use a queue abstraction.

Jobs:
- notification delivery
- email
- SMS
- large report exports
- other expensive asynchronous work

Include retry and failure handling.

============================================================
78. REPORT EXPORTS
============================================================

For small reports:
- direct response/download may be acceptable.

For large reports:
- background job
- generated file
- secure download

Never load huge datasets into the browser.

============================================================
79. DATABASE MIGRATIONS
============================================================

Use Prisma migrations.

Never modify production schema manually without migration tracking.

Before schema changes:
- inspect dependencies
- create migration
- test migration
- verify data safety

Never casually drop historical columns/tables.

============================================================
80. SEED DATA
============================================================

Development seed data may be created only for development/testing.

It must:
- be clearly identified as seed data
- never be used as runtime mock data
- never be required by production UI

Production UI must query the actual database.

============================================================
81. DOCUMENTATION
============================================================

Maintain:

README.md
ARCHITECTURE.md
DATABASE.md
API.md
SECURITY.md

Document:
- setup
- environment variables
- migrations
- database structure
- API conventions
- authentication
- authorization
- deployment
- background jobs
- storage
- testing

============================================================
82. ENVIRONMENT VARIABLES
============================================================

Create .env.example.

Never commit secrets.

Expected categories:

DATABASE_URL
AUTH_SECRET
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
EMAIL_PROVIDER settings
SMS_PROVIDER settings
QUEUE settings where needed

Validate environment configuration at startup.

============================================================
83. DEVELOPMENT PHASES
============================================================

Implement in this order.

PHASE 0:
Repository inspection
Architecture
Requirements analysis

PHASE 1:
Project foundation
Next.js
TypeScript
PostgreSQL
Prisma
UI system
testing

PHASE 2:
Authentication
Users
Roles
Authorization

PHASE 3:
Institution
Academic years
Trades
Semesters
Shifts
Sections

PHASE 4:
Courses
Curriculum

PHASE 5:
Students
Enrollments

PHASE 6:
CourseOfferings

PHASE 7:
Teachers
Teacher assignments

PHASE 8:
Teacher substitution

PHASE 9:
Schedules

PHASE 10:
Attendance
History
Approvals

PHASE 11:
Assessments

PHASE 12:
PDF submissions
Private storage

PHASE 13:
Marks
History
Approvals
Grading

PHASE 14:
Promotion
Repetition

PHASE 15:
Notices

PHASE 16:
Notifications

PHASE 17:
Reports

PHASE 18:
Audit

PHASE 19:
Admin UI completion

PHASE 20:
Teacher UI completion

PHASE 21:
Student UI completion

PHASE 22:
Security/concurrency review

PHASE 23:
Full E2E testing

PHASE 24:
Production readiness

============================================================
84. PAGE IMPLEMENTATION PROCESS
============================================================

For EVERY page:

1. Identify purpose.
2. Identify required API.
3. Verify API exists.
4. Implement missing backend API if necessary.
5. Define response/request types.
6. Add validation.
7. Add API client method.
8. Build loading state.
9. Build error state.
10. Build empty state.
11. Build UI.
12. Connect real API.
13. Implement mutations.
14. Refresh/invalidate server state.
15. Implement authorization UX.
16. Test.
17. Test responsive layout.
18. Test accessibility.
19. Review for mock data.
20. Stop.

============================================================
85. NO MOCK-DATA ACCEPTANCE CHECK
============================================================

Before considering a page complete, search the implementation for:

- mock
- dummy
- fake
- sample
- demo
- placeholder arrays
- hardcoded records
- TODO replace with API

Remove runtime mock data.

Development fixtures are allowed only inside tests/seed infrastructure.

============================================================
86. UI QUALITY
============================================================

The UI must look like a modern SaaS education product.

Use:
- colorful but controlled palette
- clean cards
- meaningful icons
- modern tables
- attractive charts
- consistent badges
- good whitespace
- responsive layouts
- polished dialogs
- intuitive navigation

Do not create:
- cluttered interfaces
- excessive gradients
- excessive animations
- inconsistent colors
- giant forms without grouping
- raw database-looking screens

Use animation sparingly and only where it improves UX.

============================================================
87. DATA VISUALIZATION
============================================================

Use charts when useful.

Admin:
- attendance distribution
- attendance trend
- student distribution

Teacher:
- assessment performance

Student:
- attendance by course
- marks overview

All chart data must come from real API responses.

No random values.

============================================================
88. FINAL SECURITY REVIEW
============================================================

Before production, inspect every endpoint for authorization.

For every resource ID:
- who owns it?
- who is allowed to access it?
- what relationship proves access?

Especially verify:
- student ownership
- teacher assignment
- CourseOffering membership
- file access
- attendance
- marks
- promotions
- notices
- reports
- audit logs

============================================================
89. FINAL DATABASE REVIEW
============================================================

Verify:
- foreign keys
- unique constraints
- indexes
- historical preservation
- transactions
- cascade behavior
- archive strategy
- concurrency safety

Do not allow cascade deletes to accidentally destroy academic history.

============================================================
90. FINAL PRODUCTION CHECKLIST
============================================================

Before declaring complete:

[ ] Authentication works
[ ] Role authorization works
[ ] IDOR protection tested
[ ] Academic configuration works
[ ] Semester count configurable
[ ] Shift count configurable
[ ] Courses reusable
[ ] Curriculum works
[ ] CourseOfferings work
[ ] Student enrollment works
[ ] Promotion works
[ ] Repetition works
[ ] Teacher assignment works
[ ] Teacher substitution works
[ ] Historical teacher data preserved
[ ] Schedule versioning works
[ ] Attendance works
[ ] Attendance history works
[ ] Attendance approval works
[ ] Assessments work
[ ] PDF submission works
[ ] Private storage works
[ ] Marks work
[ ] Mark history works
[ ] Mark approval works
[ ] Grading service works
[ ] Notices work
[ ] In-app notifications work
[ ] Email works
[ ] SMS works
[ ] Push notifications are NOT implemented
[ ] Reports work
[ ] Audit logs work
[ ] Responsive UI works
[ ] Accessibility reviewed
[ ] No runtime mock data
[ ] API documentation complete
[ ] Database documentation complete
[ ] Security review complete
[ ] Concurrency review complete
[ ] Unit tests pass
[ ] Integration tests pass
[ ] E2E tests pass
[ ] Production build passes

============================================================
91. FIRST TASK
============================================================

DO NOT start building the entire application.

Your first task is:

1. Inspect the repository.
2. Analyze the existing codebase.
3. Identify the current technology.
4. Identify missing infrastructure.
5. Identify requirement contradictions/ambiguities.
6. Propose the final architecture.
7. Propose the complete ER/database design.
8. Propose Prisma models.
9. Propose indexes and constraints.
10. Propose API resource structure.
11. Propose authorization relationships.
12. Propose frontend route structure.
13. Propose page relationships/workflows.
14. Propose implementation phases.
15. Create/update ARCHITECTURE.md.
16. Do NOT implement application features yet.

Then stop.

Wait for the next instruction.

============================================================
92. FINAL PRINCIPLE
============================================================

Build this as a real production application, not a prototype.

The database is the source of truth.

The backend is the authority.

The API is the contract.

The UI is the user experience.

Historical academic data is permanent.

Authorization must be enforced server-side.

Business rules must live in domain/application services.

Important invariants must be protected by database constraints.

No runtime mock data.

No fake API responses.

No hidden business-rule shortcuts.

No automatic progression to the next phase.

Build carefully, test continuously, and preserve the integrity of the academic data.
