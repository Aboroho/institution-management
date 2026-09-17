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
| notifications | In-app + async email/SMS. Approval requests notify active admins. **No push notifications.** |
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
- Enrollment roll numbers are required, admin-supplied, and unique within each section
  (`sectionId + rollNumber`); duplicates are rejected with a field error, and promotion/repetition
  assign the next free number in the destination section.
- Semester unique per trade; section unique per full academic context.
- Admin student deletion is guarded: accounts with academic history are deactivated instead of
  deleting records, while unused student accounts can be permanently removed after UI confirmation.

## Key invariants (service-enforced, no DB change)

- **Single active curriculum per trade + semester**: activating/creating an active curriculum deactivates all others of the same trade + semester inside a transaction (`courses.service.ts`). At most one curriculum is active; zero is possible (blocks offerings until one is activated).
- **Offerings restricted to the active curriculum**: `createOffering` (and any future course change on update) rejects a course that is not in the active curriculum of the offering's trade + semester (`assertCourseInActiveCurriculum`), or when no active curriculum exists (`offerings.service.ts`).
- Frontend mirrors these rules for UX only: the offering dialog loads courses from `GET /api/v1/curricula/active?tradeId=&semesterId=` and disables saving until a curriculum course is selected.

## Decisions

1. Custom JWT sessions instead of Auth.js: full control over role claims, simple cookie flow, easy to test.
2. `activeSlot` unique-field pattern instead of partial indexes: portable in Prisma, race-safe with transactions.
3. Local-filesystem storage fallback: dev works without S3; production uses private S3 + signed URLs.
4. Strict TypeScript, Zod on every write endpoint, consistent `{data, meta}` / `{error}` envelopes.

## Validation UX review (2026-09-14)

The UI uses a shared `CrudPage` plus custom workflow pages. API Zod errors already
include `details.fieldErrors` and `details.formErrors`, but the UI previously
rendered only the top-level "Validation failed" string. Required markers in the
shared CRUD dialog did not enforce required values.

Implemented plan:
- Parse validation details defensively in `src/lib/validation/form-errors.ts`.
  `ApiError.message` now includes readable field names and all validation messages,
  so existing custom screens displaying it gain useful error summaries immediately.
  Preserve specific business/validation instructions; hide internal 5xx messages
  and explain network failures with a recovery action.
- Shared CRUD dialogs validate visible required/email/number/date inputs before
  submission. Server validation remains authoritative. Show inline messages,
  red invalid borders, associated labels/help/error IDs, an alert summary and
  first-invalid-field focus. Clear a field's stale error when edited and reset
  errors when opening another record. Use form submission for Enter-key support
  and disable editing/closing while saving. No domain rules or payload semantics
  were changed.
- Login now associates errors with inputs and maps server validation errors to
  React Hook Form. Invalid credentials remain a form-level error to avoid
  identifying which credential matched.
- Regression tests cover parsing, malformed details, multiple field errors,
  message preservation, network errors, basic validation and accessible markup.

Scope / follow-up: custom student, enrollment, assessment, marks, attendance,
settings and other workflow forms benefit from the improved API error summary
where they display `ApiError.message`, but have not all been migrated to inline
errors. Use the shared parser when migrating them; keep unmatched fields and
form-level errors visible in the summary. Nested Zod paths are currently flattened
by the API to top-level keys; row-specific inline validation for bulk workflows
requires a backwards-compatible issue-path API addition. Avoid guessing field
assignments for business conflicts that have no structured field details.

## Reporting & Export Architecture (2026-09-17)

The reporting system provides attendance and marks reporting with dedicated browser
pages/tabs, JSON REST APIs, and replaceable XLSX/PDF export engines.

```text
Database (PostgreSQL + Prisma)
       ↓ (Explicit field selection, no passwords/hashes/tokens/secrets)
Report Data Service (src/modules/reporting/reporting.service.ts)
       ↓
Normalized Report DTO (src/modules/reporting/reporting.types.ts)
       ↓
       ├── Browser Report Views (HTML/CSS Presentation Model)
       └── Export Engine Interface (src/modules/reporting/exporters/exporter.interface.ts)
               ├── Browser XLSX Engine (ExcelJS)
               ├── Browser PDF Engine (jsPDF + jsPDF-AutoTable)
               ├── Server XLSX Engine (future)
               └── Server PDF Engine (future)
```

### 1. Separation of Responsibilities
- **ReportService**: Receives validated parameters, queries permitted database models using explicit selections, calculates domain summaries and counts, and returns normalized, serializable Report DTOs. It contains no UI code, no React dependencies, and no export/PDF/XLSX code.
- **Report DTOs**: Explicit, minimal, and frontend-safe data contracts. Sensitive fields (passwords, hashes, tokens, cookies, auth metadata, database connection details) are completely excluded.
- **Export Engine**: Implements the `ReportExporter<TReport>` interface:
  ```ts
  interface ReportExporter<TReport> {
    readonly format: ExportFormat; // "xlsx" | "pdf"
    readonly runtime: ExportRuntime; // "browser" | "server"
    export(report: TReport, options?: Partial<ExportOptions>): Promise<GeneratedReportFile>;
  }
  ```
  Exporters consume only authorized Report DTOs and export options. They do not query the database, access auth/session states, or contain authorization logic.

### 2. Replacing or Adding Server-Side Exporters
The default export runtime is managed centrally via `DefaultExporterRegistry` (`src/modules/reporting/exporters/exporter.registry.ts`).
To add or switch to a server-side exporter in the future:
1. Implement `ReportExporter<TReport>` with `runtime = "server"`.
2. Register the implementation in `DefaultExporterRegistry.getInstance().register(new ServerXlsxExporter())`.
3. Set default runtime to `"server"` via `setDefaultExportRuntime("server")`.
Neither report calculation logic, report DTOs, attendance business rules, marks rules, report UI views, nor backend authorization require modification.

### 3. Security Boundary & Authorization Flow
All report endpoints enforce server-side authorization before report generation:
1. Authenticate user session.
2. Authorize requested report scope:
   - **Admin**: Authorized for all institution reports.
   - **Teacher**: Authorized only for assigned course offerings.
   - **Student**: Authorized strictly for own student ID (preventing IDOR).
3. Query permitted data with explicit Prisma selects.
4. Return normalized JSON DTO to the client.

### 4. Adding a New Report Format
To introduce a new format (e.g. CSV or HTML zip bundle):
1. Add format to `ExportFormat` union in `exporter.interface.ts`.
2. Implement `ReportExporter<TReport>` for the format.
3. Register the exporter in `DefaultExporterRegistry`.
4. Add an export button in `ReportExportControls`.

Verification: unit suite passes. Full typecheck/build is blocked here by Prisma
engine downloads failing TLS connection (generated Prisma types unavailable).
`npm run lint` prompts for initial ESLint configuration; the repository does not
currently provide it. Browser interaction/E2E validation remains to be run in a
configured environment. Suggested manual checks: submit a blank CRUD form, correct
only one field, submit a server-rejected value, retry after a connection failure,
then close/reopen and edit another record; verify focus, error clearing, preserved
values and keyboard submission throughout.
