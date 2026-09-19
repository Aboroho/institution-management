# UI/UX audit and improvement report

**Scope:** existing EMS app (Next.js App Router, Prisma, PostgreSQL; ADMIN / TEACHER / STUDENT).
**Approach:** improve in place. No rebuild, no redesign of unrelated features, no schema changes, no new dependencies.
**Result:** 74 files changed, +3121 / −967. Four new files.

---

## 1. Issues found

### Async feedback was frequently absent, and sometimes fabricated

| Issue | Where | Consequence |
|---|---|---|
| `{saving && <Spinner />} Save` idiom | 20 files | A spinner appeared, but the button had no `aria-busy` and relied on a separately-written `disabled` expression. Where that expression was forgotten, the action was double-submittable. Screen readers announced nothing. |
| `alert()` on failure | admin attendance `:64`, admin marks `:37` | Approval failures surfaced as an unstyled modal that blocked the thread and could not be styled, tested or announced. |
| `confirm()` before a destructive action | curricula detail, enrollments | Same problem, plus **the error path was discarded entirely** — `await del(...)` with no try/catch, so a rejected request left the row on screen with no explanation. |
| `setTimeout(..., 1000)` to clear status | `report-export-controls.tsx` | An invented delay. It also kept both export buttons disabled for a second *after* the download had already been handed to the browser. |
| "Report generated. Downloading..." set before the file existed | same file | A hardcoded claim, not an observation. |
| Mark-seen had no per-row state | `notification-list.tsx` | Clicking "Mark seen" looked inert until the list happened to revalidate. |
| Filter/search changes replaced the whole table with a skeleton | `crud.tsx` and list pages | Every keystroke-driven refetch blanked the page, so the screen looked like it was reloading. |

### Skeletons did not match their content

The design system exported one `LoadingSkeleton` — a stack of identical grey bars — and **51 files used it** as a stand-in for tables, forms, dashboards, detail panels and card lists alike. It never matched what replaced it, so essentially every screen shifted on load.

### Navigation

- The drawer had no focus trap, no scroll lock, no Escape handler and no visible close button.
- When closed on mobile it was translated off-screen but **still in the tab order** — keyboard users tabbed into an invisible menu.
- No desktop collapse at all.
- Mobile rendered a *second* user row separate from the desktop one — two implementations of the same thing.

### Notices

- `listEligibleNoticeRecipients` returned **every** eligible student, offering and teacher, unpaginated, on composer open. On a real roll that is thousands of rows over the wire before the user types anything.
- Recipient pickers were local checkbox lists (`MultiPicker`) with no search.
- Admin and teacher notice list pages were near-identical copies.
- Long notice and notification bodies were dumped in full into list rows.
- Student notices fetched `limit=100` in one shot with no pagination.

---

## 2. Improvements made

### Async feedback

- **`Button` gains `loading` / `loadingText`** — sets `aria-busy`, swaps the label, and disables itself. This makes the correct behaviour the default rather than something each call site re-derives. All 20 manual-spinner sites converted.
- **`alert()` / `confirm()` eliminated.** Destructive actions now use `ConfirmDialog` (focus-trapped, `busy`-aware, renders the failure *inside* the dialog so the user keeps their context and can retry). Non-blocking outcomes use `StatusMessage`.
- **Approval flows** (`admin/attendance`, `admin/marks`) track `{ id, approve }` for the in-flight request, so only the affected row shows progress, other rows disable, and a double-click cannot submit twice. Both success and failure are reported.
- **Export controls** report the real filename on completion and never disable on a timer.
- **`keepPreviousData`** on list queries: the previous page stays visible with a small `InlineLoading` next to the filters, instead of the table being replaced.
- Input is preserved on failure everywhere — no form clears itself on a rejected request.

### Skeletons

Removed `LoadingSkeleton` outright (replaced by a comment explaining why, so it is not reintroduced). Added `DetailSkeleton` and `DashboardSkeleton` to the existing shaped set, then converted all 51 call sites to the skeleton whose shape matches the real content — `TableSkeleton` with the actual column count, `CardListSkeleton`, `FormSkeleton`, `StatCardsSkeleton`, `TextBlockSkeleton`.

Every skeleton carries `role="status"` + `aria-live="polite"` + an accessible label naming what is loading (`"Loading enrollments"`, not `"Loading"`).

### Navigation

One `AppShell` for all three roles; role differences are data (`ADMIN_NAV` / `TEACHER_NAV` / `STUDENT_NAV` arrays with a `group` field), not separate components.

**Mobile:** hamburger on the left of a sticky header (`aria-expanded` + `aria-controls`); drawer with brand and a labelled close button; scrim closes on outside click; Escape closes and returns focus to the toggle; Tab is trapped; `document.body.style.overflow` locked while open; auto-closes on route change; 44px touch targets; profile and logout live in the drawer rather than a duplicated row.

The closed drawer is `invisible` rather than merely translated, so it leaves the tab order and the accessibility tree — `lg:visible` keeps the desktop rail reachable. This was found by reading the rendered markup during verification.

**Desktop:** collapsible rail (`lg:w-64` ↔ `lg:w-[4.5rem]`). Collapsed items get a right-side `Tooltip`, an `aria-label` and a dot badge for unread; group headers become dividers. Preference persists under `localStorage["ems.nav.collapsed"]`, read in a mount effect and wrapped in try/catch for private-mode.

### Notices

- **Backend now searches and pages.** `listEligibleNoticeRecipients` returns permissions and *counts* only; a new `searchNoticeRecipients` serves `?kind=&search=&page=&limit=` through the shared `parsePagination` (default 25, max 100); `POST /notices/recipients` re-labels already-selected IDs so a chip stays readable when its option is off the current page.
- **`SearchableMultiSelect`** (new shared component): debounced search, incremental paging, selected-count, individual chip removal, an unambiguous "Select all N matching" that states its scope, keyboard navigation, and distinct empty/loading states. Selections persist across queries. Stale responses are dropped via a request-id guard, made possible by teaching `apiFetch` to rethrow `AbortError` untouched instead of masking it as `NETWORK_ERROR`.
- **`ExpandableText`** for long bodies: measures actual overflow with a `ResizeObserver` rather than guessing a character count, and its toggle calls `preventDefault` + `stopPropagation` so it cannot trigger the notification row's `<Link>`. Seen/read behaviour is unchanged.
- **`NoticeList`** replaces the duplicated admin and teacher pages; both are now thin wrappers.
- Student notices paginated (20/page) with debounced search.
- Marking a notification seen refreshes the shell badge **only after** the write succeeds, and navigation still proceeds if recording "seen" fails — a bookkeeping error should not block reading.

### Tooltips

Added only where a control is genuinely ambiguous: icon-only buttons, approve/reject (what each one actually does to the record), correction limits, recipient scoping, export scope, destructive actions, and the nav's collapsed icon-only mode. `HelpHint` replaces per-field helper paragraphs in the CRUD dialog — the text stays in the accessibility tree via `sr-only` + `aria-describedby`. Self-explanatory controls were left alone.

---

## 3. Shared components changed

| Component | Change |
|---|---|
| `ui.tsx` | `Button{loading,loadingText}`; new `Tooltip`, `IconButton`, `HelpHint`, `StatusMessage`, `InlineLoading`, `ExpandableText`, `ConfirmDialog`; shaped skeletons `TableSkeleton`/`CardSkeleton`/`CardListSkeleton`/`StatCardsSkeleton`/`FormSkeleton`/`TextBlockSkeleton`/**`DetailSkeleton`**/**`DashboardSkeleton`**; `Table{busy}`, `Pagination{busy}`, ARIA-correct `Tabs`, `Dialog{description,size}`; **`LoadingSkeleton` removed** |
| `shell.tsx` | Full rewrite — one shell, mobile drawer, desktop collapse |
| `crud.tsx` | `keepPreviousData`, shaped skeleton, Clear-filters, filter-aware empty state, `IconButton` row actions, `HelpHint` fields, `StatusMessage` |
| `searchable-multi-select.tsx` | **New** |
| `notices/notice-list.tsx` | **New** — shared staff notice list |
| `notices/notice-composer.tsx` | Rewritten onto the paged API |
| `notices/notice-details.tsx` | Rewritten — layout-matching skeleton, `ConfirmDialog`, per-attachment download state |
| `notifications/notification-list.tsx` | Rewritten — per-row busy state, `ExpandableText`, shaped skeleton |
| `lib/hooks/use-debounced-value.ts` | **New** — clearing bypasses the delay |
| `lib/api/client.ts` | `AbortError` rethrown; `get()` forwards a signal |

---

## 4. Pages and workflows affected

All three dashboards; admin students / teachers / sections / semesters / curricula (+detail) / courses / course-offerings (+detail) / enrollments / assessments / schedules / audit-logs / settings / promotions / teacher-assignment / attendance / marks / reports; teacher course-offerings (+detail), schedule, attendance take & edit; student courses, assessments (+detail), attendance, marks, schedule; notices and notifications for all three roles; login; profile; admin accounts.

## 5. Backend / API changes

Only what was needed to stop shipping unbounded lists:

- `GET /api/v1/notices/recipients` → permissions + counts (no option arrays).
- `GET /api/v1/notices/recipients?kind=COURSE_OFFERING|TEACHER|STUDENT&search=&page=&limit=` → paginated `{id,label,hint?}`.
- `POST /api/v1/notices/recipients` → resolves selected IDs to labels.

**Authorization is unchanged and re-verified per request:** teachers see only their assigned offerings and the students enrolled in them; `kind=TEACHER` is rejected for teachers; `canTargetEveryone` stays ADMIN-only, `canTargetAdmins` TEACHER-only. These endpoints are a UI convenience, not the boundary — `resolveTargets` independently re-validates every ID on save, so posting an ID that was never offered is still rejected. Documented in `API.md`.

No schema or migration changes.

## 6. Accessibility and responsiveness

Accessible names on every icon-only control; `aria-busy` on in-flight actions; `role="status"`/`aria-live` on skeletons and inline loading, `role="alert"` on errors; `aria-expanded`/`aria-controls`/`aria-pressed` on disclosure and toggle controls; correct `tablist`/`tab`/`aria-selected`; focus trap and focus restoration in the drawer and dialogs; visible `focus-visible` rings throughout; state never signalled by colour alone (unread is a text label *and* a border, not just a colour). Verified against the rendered markup: 9 announced status regions, `aria-expanded`/`aria-controls` wired on the hamburger, `aria-pressed` on the collapse toggle, and every interactive element carrying a name.

Responsive: mobile-first list/table layouts retained, 44px targets, grids collapsing at `sm`/`lg`, and content layout staying aligned with the rail in both collapsed and expanded states.

## 7. Validation actually run

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **Clean.** Run after each change set. |
| `npx next lint` | **Clean** — no warnings or errors. |
| `npx vitest run` | **401 passed, 16 skipped, 36 suites passed / 3 skipped.** Baseline was 388 passed; the 13 added are the new guards. No pre-existing test was modified or weakened. |
| `npx next build` | **Compiled successfully**; 50/50 static pages generated. |

I also ran the dev server and fetched the rendered HTML to inspect real markup rather than trusting the source — which is how the off-screen-drawer tab-order bug was found and fixed.

New guard suite `src/tests/unit/ui-feedback-conventions.test.ts` (13 tests) locks in: no `alert`/`confirm`, no timer-simulated progress, no generic skeleton, no manual-spinner idiom, all shaped skeletons present and announced, one shell with Escape/scroll-lock/focus-trap, the persisted nav key, no unbounded recipient fetch, and recipient authorization. **I verified these fail when the regression is reintroduced** (temporarily re-adding `alert()` and `LoadingSkeleton` to a page made exactly the right two tests fail) rather than assuming a green run meant they were wired up.

No `any`, `as any`, `@ts-ignore` or `@ts-expect-error` was added.

## 8. Limitations

- **No live data verification.** `binaries.prisma.sh` is unreachable from this sandbox, so the Prisma query engine cannot be downloaded. Types are real — the client was generated with placeholder engine files — but no query can execute. I did start a real PostgreSQL 15 (via `pgserver`) and confirmed the app boots and renders, but every DB-backed request fails at the engine, so **the screens were verified as markup and types, not against live records.** The integration smoke test remains skipped for the same reason. `npm run build` succeeds regardless.
- **No browser-driven interaction test.** Playwright's browser download is also blocked, so drawer focus-trap, Escape, scroll-lock and tooltip hover were verified by reading the implementation and the server-rendered DOM, not by driving a real browser. Worth one manual pass on a device.
- **`ExpandableText` needs a client measure pass.** The Show more control only appears after the `ResizeObserver` reports overflow, so it is absent from server-rendered HTML by design.
- Unread-count polling still runs on a 60s interval, as before. A push/socket channel would be better but is out of scope for a UI pass.
