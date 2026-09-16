# EMS — Security

## Authentication & sessions

- Passwords hashed with bcrypt (cost 12). Strength: min 8 chars.
- JWT (HS256, `AUTH_SECRET` ≥ 16 chars) in httpOnly, SameSite=Lax cookie; Secure in production.
- Inactive users cannot authenticate; sessions revalidated against DB on each request.
- Session revocation with stateless JWTs: tokens carry `tokenVersion`; a password change
  bumps `User.tokenVersion`, so every older cookie is rejected by `getAuth` (the current
  device is re-issued a fresh cookie). Deleted/deactivated accounts stop authenticating.
- Profile self-service (`/users/me*`): the actor id always comes from the verified session,
  never from the client; mass assignment is blocked by strict Zod schemas (`role`,
  `isSeedAdmin`, `isActive`, `id`, `passwordHash`, `tokenVersion` are rejected, 422).
- The protected seed admin (`User.isSeedAdmin`, set only by `prisma/seed.ts`) can change
  nothing about its account from the application and cannot be deleted, demoted or
  re-parented — enforced server-side in the users service, including a re-check inside the
  deletion transaction; denied attempts are audited with no credential material.
- Admin management (`POST/DELETE /users`) creates only normal ADMIN accounts and refuses
  deletion of accounts that history references (409), so audit/academic records survive.

## Authorization (backend authoritative)

- Every protected endpoint enforces role + relationship checks in `src/lib/permissions/`.
- Teachers: active `TeacherCourseAssignment` on the exact offering (attendance, marks,
  assessments, notices, schedules, students).
- Attendance writes are teacher-only: `POST /attendance/sessions` and
  `POST /attendance/change-requests` reject admins/students with 403.
  The only admin path that changes attendance is approving a pending
  `AttendanceChangeRequest` (transactional + audit-logged); the service layer
  rejects admin writes defensively as a second layer.
- Students: own records only (`requireStudentSelf`), enrollment membership for offerings.
- Client-supplied IDs are never trusted (IDOR tests in `src/tests/e2e/`).

## Data protection

- Audit log is append-only in practice (no update/delete endpoints); never stores passwords/secrets.
- Files in private storage; downloads require authorization; S3 via short-lived signed URLs.
- Upload validation: extension + MIME + 50MB + PDF magic bytes, server-side.
- Error responses never leak stack traces, SQL, or secrets.
- Security headers: nosniff, DENY framing, strict referrer policy.

## Integrity & concurrency

- Unique constraints + serializable transactions for substitution, approvals, promotions.
- `activeSlot` unique pattern prevents dual active teachers under races.
- Immutable domain histories: `AttendanceChangeLog`, `AssessmentMarkChangeLog`.

## Operations

- Secrets only via environment (`.env.example` documents all). Never commit `.env`.
- Rate limiting: add an edge/CDN limiter in production for `/api/v1/auth/*`.
- Email/SMS are async with retries; provider failures never block user requests.

## Pre-production checklist

- [ ] `AUTH_SECRET` rotated, ≥32 random chars
- [ ] Postgres + S3 credentials least-privilege, private bucket
- [ ] HTTPS enforced, Secure cookies
- [ ] Backups + migration-tested restores
- [ ] `npm run test`, `npm run build`, E2E live pass
