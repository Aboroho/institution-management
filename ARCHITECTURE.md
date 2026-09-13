# EMS — Architecture

Modular monolith (Next.js App Router + Prisma + PostgreSQL). One institution/campus; no multi-tenancy.

## Layers

```
UI (role portals: /admin, /teacher, /student)
 -> centralized API client (src/lib/api/client.ts)
 -> REST API (/api/v1/* route handlers: authn/authz + validation only)
 -> domain services (src/modules/*: ALL business rules)
 -> Prisma -> PostgreSQL
```

Rules:
- Route handlers never contain business logic; they authenticate, authorize, validate (Zod), call services.
- React components never contain business logic; grading lives in `GradingService`.
- Backend is authoritative: every protected endpoint re-verifies ownership/assignment (IDOR protection).

## Modules

| Module | Responsibility |
|---|---|
| academic | Institution, years, trades, semesters, shifts, sections |
| courses | Reusable courses, versioned curricula |
| course-offerings | Class instances (unique on year+trade+semester+shift+section+course) |
| students | Users+students, enrollments (history preserved) |
| teachers | Users+teachers, assignments, substitution (transactional) |
| schedules | Versioned schedules per offering |
| attendance | Sessions (unique per offering+date), corrections, approvals |
| assessments | Assessments (no `gradable` field by design) |
| submissions | PDF-only ≤50MB uploads to private S3-compatible storage |
| marks | Marks, histories, approvals, `GradingService` |
| promotions | Eligibility preview + transactional execution, new enrollments |
| notices | Per-offering announcements (preserved across substitution) |
| notifications | In-app + async email/SMS. **No push notifications.** |
| reports | Server-side aggregations + dashboards |
| audit | Immutable audit log |

## Auth

- JWT (HS256 via `jose`) in httpOnly `ems_session` cookie.
- Roles: ADMIN (institution-wide), TEACHER (active-assignment scoped), STUDENT (own data only).
- `middleware.ts` guards portal routes; API routes enforce authorization again (UI hiding is not security).

## Background work

`src/lib/notifications/queue.ts` — in-process async queue with retries for email/SMS delivery.
Swap with BullMQ/Redis for multi-instance production (same `enqueue` interface).

## Key invariants (DB-enforced)

- One active teacher per offering: `TeacherCourseAssignment.activeSlot @unique` (set to offering id while active, null when closed).
- One attendance session per offering per date; one mark per assessment+student; one submission per assessment+student.
- Course codes, student IDs (permanent), employee IDs unique.
- Semester unique per trade; section unique per full academic context.

## Decisions

1. Custom JWT sessions instead of Auth.js: full control over role claims, simple cookie flow, easy to test.
2. `activeSlot` unique-field pattern instead of partial indexes: portable in Prisma, race-safe with transactions.
3. Local-filesystem storage fallback: dev works without S3; production uses private S3 + signed URLs.
4. Strict TypeScript, Zod on every write endpoint, consistent `{data, meta}` / `{error}` envelopes.
