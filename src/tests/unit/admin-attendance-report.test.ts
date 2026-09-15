import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Attendance Report for the admin route (/admin/attendance → "Attendance
 * Report" tab): the session list itself.
 *
 * The list is rendered server-side (no browser needed) against the real
 * component with SWR mocked, so this pins what an admin actually sees for the
 * selected course offering:
 *   - one card per session with the date badge and the DB-aggregated summary,
 *   - the stored update count (one edit = one update),
 *   - the read-only actions only (no Edit on the admin route),
 *   - the pager, which must count `meta.total` (records), not the page length,
 *   - the empty state when the offering has no sessions.
 *
 * The endpoint it calls is asserted too, so the report can never silently drift
 * to a different API.
 */

const { requestedPaths, swrState } = vi.hoisted(() => ({
  requestedPaths: [] as string[],
  swrState: { report: undefined as unknown },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    // Keep the real `qs()` (query building is part of what we check).
    get: (path: string) => {
      requestedPaths.push(path);
      return Promise.resolve({ data: [] });
    },
  };
});

vi.mock("swr", () => ({
  default: (key: string | null, fetcher?: () => Promise<unknown>) => {
    if (key && fetcher) void fetcher().catch(() => undefined);
    return {
      data: key ? swrState.report : undefined,
      isLoading: false,
      error: undefined,
      mutate: () => Promise.resolve(),
    };
  },
}));

import { AttendanceReportList } from "@/components/attendance/attendance-report-list";
import { monthYearLabel, weekdayName } from "@/components/attendance/date-display";

const session = (id: string, attendanceDate: string, updateCount: number, present: number) => ({
  id,
  attendanceDate,
  updateCount,
  summary: { total: 41, present, absent: 2, late: 1, excused: 0 },
  courseOfferingId: "offering-1",
});

/** Two sessions, as the report API returns them. */
function reportPage(overrides: Record<string, unknown> = {}) {
  return {
    data: [session("s-1", "2026-09-15", 2, 38), session("s-2", "2026-09-14", 0, 41)],
    meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    ...overrides,
  };
}

function renderReport(props: Partial<Parameters<typeof AttendanceReportList>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(AttendanceReportList, {
      offeringId: "offering-1",
      offeringTitle: "Digital Electronics · Section A",
      showEdit: false,
      ...props,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requestedPaths.length = 0;
  swrState.report = reportPage();
});

describe("Attendance Report — sessions for the selected offering", () => {
  it("renders one card per session with the date badge and summary", () => {
    const html = renderReport();

    expect(html).toContain(weekdayName("2026-09-15"));
    expect(html).toContain(monthYearLabel("2026-09-15"));
    expect(html).toContain("Tuesday September 15, 2026"); // badge aria-label
    expect(html).toContain(weekdayName("2026-09-14"));
    expect(html).toContain("Digital Electronics · Section A");

    // Summary stats (Total / Present / Absent / Late / Excused).
    for (const label of ["Total", "Present", "Absent", "Late", "Excused"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain(">41<"); // total
    expect(html).toContain(">38<"); // present on 2026-09-15
  });

  it("shows the stored update count with correct pluralisation", () => {
    swrState.report = reportPage({
      data: [
        session("s-1", "2026-09-15", 2, 38),
        session("s-2", "2026-09-14", 1, 41),
        session("s-3", "2026-09-13", 0, 40),
      ],
    });
    const html = renderReport();
    expect(html).toContain("Updated: 2 times");
    expect(html).toContain("Updated: 1 time");
    expect(html).toContain("Updated: 0 times");
  });

  it("is read-only on the admin route: Student Status + History, never Edit", () => {
    const html = renderReport();
    expect(html).toContain("Student Status");
    expect(html).toContain("History");
    expect(html).not.toMatch(/>\s*Edit\s*</);
  });

  it("counts records (meta.total) on the pager, not the page length", () => {
    swrState.report = reportPage({ meta: { page: 1, limit: 20, total: 57, totalPages: 3 } });
    const html = renderReport();
    expect(html).toContain("Page 1 of 3 · 57 records");
  });

  it("asks the offering-scoped report endpoint with pagination", () => {
    renderReport();
    expect(requestedPaths).toContain("/course-offerings/offering-1/attendance/sessions?page=1&pageSize=20");
  });

  it("scopes the request to the offering it was given", () => {
    renderReport({ offeringId: "offering-77" });
    expect(requestedPaths).toContain("/course-offerings/offering-77/attendance/sessions?page=1&pageSize=20");
  });

  it("shows an empty state when the offering has no sessions", () => {
    swrState.report = reportPage({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const html = renderReport();
    expect(html).toContain("No attendance records found.");
    expect(html).not.toContain("Student Status");
  });

  it("offers a date range filter", () => {
    const html = renderReport();
    expect(html).toContain('id="att-from"');
    expect(html).toContain('id="att-to"');
    expect(html).toContain("Page size");
  });

  it("can still show Edit where it is allowed (teacher routes)", () => {
    const html = renderReport({ showEdit: true, editBasePath: "/teacher/course-offerings/offering-1/attendance/edit" });
    expect(html).toMatch(/>\s*Edit\s*</);
  });
});
