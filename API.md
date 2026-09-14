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
| POST | /enrollments/{id}/close | ADMIN |
| POST | /promotions/preview, /promotions/execute | ADMIN |
| GET | /promotions/history | ADMIN |
| GET/POST | /teachers | ADMIN |
| GET/PATCH | /teachers/{id} | ADMIN |
| GET/POST | /teacher-assignments | ADMIN |
| POST | /teacher-assignments/substitute | ADMIN |
| GET/POST | /schedules | scoped / ADMIN |
| GET | /schedules/history?courseOfferingId= | scoped |
| GET/POST | /attendance/sessions | scoped teacher+admin |
| GET | /course-offerings/{id}/attendance/sessions | scoped teacher+admin (paginated, date-filtered, server-side summary + update count) |
| GET | /attendance/sessions/{sessionId}/records | scoped teacher+admin (student attendance for one session) |
| GET | /attendance/sessions/{sessionId}/history | scoped teacher+admin (immutable change log + related change requests) |
| GET | /attendance/records/{id} | teacher+admin |
| GET/POST | /attendance/change-requests | ADMIN / scoped |
| POST | /attendance/change-requests/{id}/approve, .../reject | ADMIN |
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

Student enrollments receive a required database-generated `rollNumber`. It is unique within
a section (`sectionId + rollNumber`) and is returned by student, enrollment, section, and
course-offering student responses. `DELETE /students/{id}` is restricted to admins and
permanently removes only an unused student account; records with academic history return a
conflict so the student can be deactivated instead.

## Status codes

401 unauthenticated · 403 unauthorized (incl. `APPROVAL_REQUIRED`) · 404 not found ·
409 conflict/duplicate/state · 422 validation/business rule · 500 safe generic error.
