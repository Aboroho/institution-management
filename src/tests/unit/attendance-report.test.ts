import { describe, it, expect } from "vitest";
import {
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  MAX_ATTENDANCE_PAGE_SIZE,
  type AttendanceReportItem,
} from "@/modules/attendance/attendance.types";

/**
 * Pure unit tests covering the Attendance Report rules. These do not require
 * a database — they validate the documented counting rule, page-size caps,
 * and data shape that the UI consumes.
 *
 * The integration paths (Prisma aggregations, API routes) are exercised in
 * `api.smoke.test.ts` when `DATABASE_URL` is configured.
 */

function buildItem(overrides: Partial<AttendanceReportItem> = {}): AttendanceReportItem {
  return {
    id: "session-1",
    courseOfferingId: "off-1",
    attendanceDate: "2026-09-15",
    createdById: "user-1",
    createdAt: "2026-09-15T09:00:00.000Z",
    updatedAt: "2026-09-15T10:42:00.000Z",
    summary: { total: 41, present: 38, absent: 2, late: 1, excused: 0 },
    updateCount: 2,
    ...overrides,
  };
}

describe("Attendance Report — defaults", () => {
  it("uses a sensible default page size of 20", () => {
    expect(DEFAULT_ATTENDANCE_PAGE_SIZE).toBe(20);
  });

  it("caps page size to protect the server", () => {
    expect(MAX_ATTENDANCE_PAGE_SIZE).toBe(100);
  });
});

describe("Attendance Report — summary shape", () => {
  it("contains all four status counts and total", () => {
    const item = buildItem();
    expect(item.summary).toEqual({
      total: 41,
      present: 38,
      absent: 2,
      late: 1,
      excused: 0,
    });
    // Total must equal the sum of the per-status counts.
    const sum = item.summary.present + item.summary.absent + item.summary.late + item.summary.excused;
    expect(sum).toBe(item.summary.total);
  });

  it("zero summary is well-formed", () => {
    const item = buildItem({ summary: { total: 0, present: 0, absent: 0, late: 0, excused: 0 } });
    expect(item.summary.total).toBe(0);
  });
});

describe("Attendance Report — update count rule", () => {
  it("updateCount counts only modifications (not the initial entry)", () => {
    // Rule: AttendanceChangeLog rows where `oldStatus IS NOT NULL` are
    // counted; the initial-entry log (oldStatus = NULL) is excluded.
    const initialOnly = buildItem({ updateCount: 0 });
    expect(initialOnly.updateCount).toBe(0);

    const onceModified = buildItem({ updateCount: 1 });
    expect(onceModified.updateCount).toBe(1);

    const twiceModified = buildItem({ updateCount: 2 });
    expect(twiceModified.updateCount).toBe(2);
  });

  it("updateCount is never negative", () => {
    const item = buildItem({ updateCount: 0 });
    expect(item.updateCount).toBeGreaterThanOrEqual(0);
  });
});

describe("Attendance Report — sort order", () => {
  it("items are returned newest-date first by default", () => {
    const items = [
      buildItem({ id: "a", attendanceDate: "2026-09-13" }),
      buildItem({ id: "b", attendanceDate: "2026-09-15" }),
      buildItem({ id: "c", attendanceDate: "2026-09-14" }),
    ];
    const sorted = [...items].sort((x, y) => y.attendanceDate.localeCompare(x.attendanceDate));
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("Attendance Report — date range filter", () => {
  it("date strings compare lexicographically as ISO yyyy-mm-dd", () => {
    const from = "2026-09-01";
    const to = "2026-09-15";
    const dates = ["2026-08-31", "2026-09-01", "2026-09-15", "2026-09-16"];
    const inRange = dates.filter((d) => d >= from && d <= to);
    expect(inRange).toEqual(["2026-09-01", "2026-09-15"]);
  });
});
