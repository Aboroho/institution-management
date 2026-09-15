import { describe, it, expect } from "vitest";
import { parseISODate, weekdayName, monthYearLabel } from "@/components/attendance/date-display";

describe("Attendance Date Display — parseISODate", () => {
  it("parses yyyy-mm-dd without timezone drift", () => {
    const p = parseISODate("2026-09-15");
    expect(p).not.toBeNull();
    expect(p?.year).toBe(2026);
    expect(p?.month).toBe(9);
    expect(p?.day).toBe(15);
  });

  it("computes the correct weekday in UTC (15 Sep 2026 is Tuesday)", () => {
    const p = parseISODate("2026-09-15");
    expect(p?.weekday).toBe(2); // 0=Sun..6=Sat
  });

  it("rejects malformed strings", () => {
    expect(parseISODate("2026-9-1")).toBeNull(); // not zero-padded
    expect(parseISODate("2026/09/15")).toBeNull();
    expect(parseISODate("not a date")).toBeNull();
    expect(parseISODate("")).toBeNull();
  });

  it("rejects invalid dates", () => {
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("2026-02-30")).toBeNull();
  });
});

describe("Attendance Date Display — helpers", () => {
  it("weekdayName returns a weekday for valid input", () => {
    expect(weekdayName("2026-09-15")).toBe("Tuesday");
    expect(weekdayName("2026-09-13")).toBe("Sunday");
    expect(weekdayName("2026-09-19")).toBe("Saturday");
    expect(weekdayName("not a date")).toBe("");
  });

  it("monthYearLabel returns 'Month YYYY'", () => {
    expect(monthYearLabel("2026-09-15")).toBe("September 2026");
    expect(monthYearLabel("2026-01-01")).toBe("January 2026");
    expect(monthYearLabel("2026-12-31")).toBe("December 2026");
    expect(monthYearLabel("not a date")).toBe("");
  });
});
