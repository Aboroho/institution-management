# EMS — API

Base: `/api/v1`. Plural kebab-case resources. Envelopes:

```json
{ "data": {}, "meta": { "page": 1, "limit": 25, "total": 100 } }
{ "error": { "code": "FORBIDDEN", "message": "...", "details": null } }
```

Pagination: `?page=&limit=` (max 100). Filtering via query params, e.g.
`GET /api/v1/students?tradeId=...&semesterId=...&search=...`.

## Resources

| Method | Path | Role |
|---|---|---|
| POST | /auth/login | public |
| POST | /auth/logout | auth |
| GET | /auth/me | auth |
| GET | /users | ADMIN |
| GET/PATCH | /institution | auth / ADMIN |
| GET/POST | /academic-years | auth / ADMIN |
| GET/PATCH | /academic-years/{id} | auth / ADMIN |
| GET/POST | /trades, /semesters, /shifts, /sections, /courses, /curricula | auth / ADMIN |
| GET/PATCH | /trades/{id}, /semesters/{id}, /shifts/{id}, /sections/{id}, /courses/{id}, /curricula/{id} | auth / ADMIN |
| POST/DELETE | /curricula/{id}/courses | ADMIN |
| GET | /curricula/active?tradeId=&semesterId= | auth (returns the single active curriculum + courses, or null) |
| GET/POST | /course-offerings | scoped / ADMIN |
| GET/PATCH | /course-offerings/{id} | scoped / ADMIN |
| GET | /course-offerings/{id}/students | scoped |
| GET/POST | /students | ADMIN |
| GET/PATCH/DELETE | /students/{id} | self / ADMIN (DELETE: ADMIN only) |
| GET | /students/{id}/attendance, /students/{id}/marks | self / ADMIN |
| GET/POST | /enrollments | ADMIN |
| GET | /enrollments/next-roll?sectionId= | ADMIN (next free roll number in the section) |
| PATCH | /enrollments/{id} | ADMIN (correct a roll number) |
| POST | /enrollments/{id}/close | ADMIN |
| POST | /promotions/preview, /promotions/execute | ADMIN |
| GET | /promotions/history | ADMIN |
| GET/POST | /teachers | ADMIN |
| GET/PATCH | /teachers/{id} | ADMIN |
| GET/POST | /teacher-assignments | ADMIN (POST validates offering + academic-year status; exactly one active assignment per offering is DB-enforced via `activeSlot`) |
| POST | /teacher-assignments/substitute | ADMIN (transactional: closes the current assignment, creates the replacement; rejected for inactive offerings / inactive academic years) |
| GET/POST | /schedules | scoped / ADMIN |
| GET | /schedules/history?courseOfferingId= | scoped |
| GET | /attendance/sessions?courseOfferingId&date | scoped teacher+admin; returns the whole entry state for Take Attendance (full section roster with the recorded status per student, Present/Absent/Late/Excused summary, `permissions` correction state, `pendingChangeRequest`) or `data: null` when the date has no entry, which is the only condition under which the create form is shown |
| POST | /attendance/sessions | assigned TEACHER only (ADMIN is read-only for attendance); `mode=create` is create-only and returns 409 for a session that appeared concurrently, `mode=edit` applies the complete multi-student draft as ONE direct correction operation with the optional `reason` recorded in the change log |
| GET | /course-offerings/{id}/attendance/sessions | scoped teacher+admin (paginated, date-filtered, server-side summary + update count + per-entry `permissions` and `pendingChangeRequest`, so no screen counts corrections itself) |
| GET | /attendance/sessions/{sessionId}/records | scoped teacher+admin (full ACTIVE section roster + recorded status for one session; students enrolled after the entry was saved appear as `NOT_MARKED`) |
| GET | /attendance/sessions/{sessionId}/history | scoped teacher+admin (immutable change log + related change requests) |
| GET | /attendance/records/{id} | scoped teacher+admin |
| GET | /attendance/change-requests | ADMIN (all requests) or TEACHER (own requests only — `requestedById` is taken from the session, never from the query). Items include date, offering, submitted time, reason, status and every affected student with `oldStatus -> newStatus`. `meta.pendingCount` is the badge count |
| POST | /attendance/change-requests | assigned TEACHER only; accepts `{sessionId, reason, changes:[{recordId,newStatus}]}`. Backend-enforced: rejects while direct correction capacity remains, rejects a second request while one is PENDING (409, also on the `one_pending_per_session` unique index under concurrency), validates the reason, the change set and that every record still belongs to the entry |
| POST | /attendance/change-requests/{id}/cancel | the teacher who filed it, while it is PENDING; 409 when an admin already decided (the admin wins). Nothing is deleted: the row becomes REJECTED with the `Withdrawn by the requesting teacher before admin review.` marker, which the API reports as `displayStatus: "CANCELLED"` |
| POST | /attendance/change-requests/{id}/approve, .../reject | ADMIN; reviews and applies the complete session-level request atomically |
| GET/POST | /assessments | scoped |
| GET/PATCH | /assessments/{id} | scoped |
| GET | /submissions?assessmentId= | scoped |
| POST | /submissions (multipart: assessmentId, file) | STUDENT |
| GET | /submissions/{id}/download | scoped |
| GET/POST | /marks?assessmentId= | scoped teacher+admin |
| GET | /marks/history?markId= | teacher+admin |
| GET/POST | /marks/change-requests | ADMIN / scoped |
| POST | /marks/change-requests/{id}/approve, .../reject | ADMIN |
| GET/POST | /notices | scoped |
| PATCH | /notices/{id} | owner / ADMIN |
| GET | /notifications | auth (own) |
| POST | /notifications/{id}/read, /notifications/read-all | auth (own) |
| GET | /reports/attendance, /reports/marks, /reports/students/{id}, /reports/dashboard | ADMIN |
| GET | /reports/teacher-dashboard | TEACHER |
| GET | /reports/student-dashboard | STUDENT |
| GET | /audit-logs | ADMIN |

Scoping: teachers must hold an ACTIVE assignment on the offering; students must own the
record / be actively enrolled in the offering. Violations return 403 (IDOR protection).

A student cannot exist without a roll number. `POST /api/v1/students` now requires the
full academic context (`academicYearId`, `tradeId`, `semesterId`, `shiftId`, `sectionId`) plus
`rollNumber`. The backend creates the user, student and initial enrollment atomically; if the
roll is missing it returns 422 with a `rollNumber` field error, and a duplicate inside the
section returns 409 with a field error on `rollNumber`
(`GET /api/v1/enrollments/next-roll?sectionId=` suggests the next free number for the
enrollment form and the student creation form). `rollNumber` is unique within a section
(`sectionId + rollNumber`), so the same number may exist in a different section but not twice
in one section. `PATCH /api/v1/enrollments/{id}` corrects a mistyped roll number
(audit-logged). Roll numbers are also returned by student, enrollment, section, and
course-offering student responses. Promotion and repetition create enrollments server-side and
take the next free number in the destination section. `DELETE /students/{id}` is restricted to
admins and permanently removes only an unused student account; records with academic history
return a conflict so the student can be deactivated instead.

## Course offering `context` code

Every course-offering payload (lists, details, assignment lists) carries two
derived fields:

- `context` — the human-readable identifier, computed (never stored/entered) as
  `{course_name}-{trade_code}-{semester_number}-{shift_first_letter}-{section_name}`,
  e.g. `Digital Electronics-EC-2-M-A`. It is display-only: the CourseOffering
  database ID remains the generated `id`, and clients must never construct or
  submit IDs from the context string.
- `available` — whether the offering accepts new operations, derived as
  `offering.isActive AND academicYear.isActive`. An offering in a deactivated
  academic year is treated as inactive/unavailable: new teacher assignments,
  substitutions and new offerings are rejected (422), while historical records
  remain fully accessible.

The centralized admin UI for assignment/substitution lives at
`/admin/teacher-assignment` (Academic Year → Trade → Semester → Shift → Section
→ Course Offering → Teacher); the legacy `/admin/teacher-assignments` URL
redirects to it.

## Status codes

401 unauthenticated · 403 unauthorized (incl. `APPROVAL_REQUIRED`) · 404 not found ·
409 conflict/duplicate/state · 422 validation/business rule · 500 safe generic error.
