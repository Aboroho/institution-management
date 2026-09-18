# EMS — Security

## Authentication & sessions

- Passwords hashed with bcrypt (cost 12). Strength: min 8 chars.
- JWT (HS256, `AUTH_SECRET` ≥ 16 chars) in httpOnly, SameSite=Lax cookie; Secure in production.
- Inactive users cannot authenticate; sessions revalidated against DB on each request.

## Protected seed admin

- The seed admin is identified by a persisted column, `User.isProtectedSeedAdmin`, written
  only by `prisma/seed.ts` (idempotent; a partial unique index makes a second protected
  account impossible). Environment variables are only used to bootstrap it — they are not
  the identity, so the protection survives restarts, deployments and later .env edits.
- Applied by the backend, never by hidden UI: the account cannot change its name, email or
  password, cannot lose the ADMIN role and cannot be deleted by anyone (including itself).
  Normal admins keep the existing read-only view of user lists and cannot create, delete or
  modify admin accounts; the seed admin's privileges are limited to create/delete of normal
  ADMIN accounts.
- `isProtectedSeedAdmin`, `role`, `isActive` and `sessionVersion` are not accepted by any
  request schema (`strict()` Zod objects), so client input can neither grant nor remove the
  protection and cannot escalate privileges through mass assignment.
- Rejected attempts (profile/password change on the protected account, deletion of it,
  admin management by a non-seed admin) are audit-logged with actor, operation and reason.
- Credential rotation for the seed admin is an operator action (`SEED_ADMIN_RESET_PASSWORD=true`
  with `npm run db:seed`); the application deliberately offers no path to change it.

## Sessions and credential changes

- Session tokens carry the `User.sessionVersion` they were issued with (`sv`). Password
  changes and admin deletions/deactivations increment the stored version, so every token
  issued before the change fails `requireAuth` immediately; the device performing the
  change receives a freshly signed cookie. Old tokens never linger and no session table is
  needed.
- Password changes verify the current password with bcrypt and use a compare-and-swap on
  the verified hash, so two concurrent changes cannot both succeed (the loser gets 409).
- Passwords are never logged, returned, or included in audit entries; API responses select
  explicit fields and never expose `passwordHash`.

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
