import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Admin attendance browser (/admin/attendance) — the filter bar itself.
 *
 * The cascade RULES are unit tested in `attendance-browser-filters.test.ts`.
 * This file renders the real component (server-side, no browser needed) to make
 * sure the trade select is actually wired into the filter bar, in the
 * documented cascade order (README §68:
 * academic year → trade → semester → shift → section → course offering).
 *
 * SWR is mocked with canned option rows; nothing here touches the network.
 */

const { ROWS, requestedPaths } = vi.hoisted(() => ({
  ROWS: {
    "att-years": [{ id: "y1", name: "2026-27" }],
    "att-trades": [
      { id: "t1", name: "Computer Science", code: "CSE" },
      { id: "t2", name: "Electrical Engineering", code: "EE" },
    ],
    "att-semesters": [
      { id: "s1", name: "Semester 1", trade: { id: "t1", name: "Computer Science", code: "CSE" } },
    ],
    "att-shifts": [{ id: "sh1", name: "Morning", code: "MORNING" }],
  } as Record<string, Record<string, unknown>[] | undefined>,
  requestedPaths: [] as string[],
}));

// The component's real fetchers run (so the requested API paths are captured),
// but the mocked SWR serves canned rows instead of the promise result.
vi.mock("@/lib/api/client", () => ({
  get: (path: string) => {
    requestedPaths.push(path);
    return Promise.resolve({ data: [] });
  },
}));

vi.mock("swr", () => ({
  default: (key: string | null, fetcher?: () => Promise<unknown>) => {
    if (key && fetcher) void fetcher().catch(() => undefined);
    return {
      data: key ? ROWS[key] : undefined,
      isLoading: false,
      error: undefined,
      mutate: () => Promise.resolve(),
    };
  },
}));

import { AdminAttendanceBrowser } from "@/components/attendance/admin-attendance-browser";

function renderBrowser() {
  return renderToStaticMarkup(createElement(AdminAttendanceBrowser));
}

/** Trigger button markup for one selector (label + placeholder). */
function selectTrigger(html: string, ariaLabel: string) {
  return new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>.*?</button>`, "s").exec(html)?.[0] ?? "";
}

describe("Admin attendance browser — filter bar", () => {
  it("offers a trade select", () => {
    const html = renderBrowser();
    expect(html).toContain(">Trade<");
    expect(selectTrigger(html, "Trade")).not.toBe("");
    expect(selectTrigger(html, "Trade")).toContain("All trades");
  });

  it("keeps the documented cascade order", () => {
    const html = renderBrowser();
    const order = ["Academic year", "Trade", "Semester", "Shift", "Section", "Course offering"];
    const positions = order.map((label) => html.indexOf(`aria-label="${label}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("loads its options from the real API (no hardcoded lists)", () => {
    renderBrowser();
    expect(requestedPaths).toContain("/trades?limit=100");
    expect(requestedPaths).toContain("/academic-years?limit=100");
    expect(requestedPaths).toContain("/shifts");
    // No trade chosen yet → every semester is listed, narrowed by trade later.
    expect(requestedPaths).toContain("/semesters");
  });

  it("does not query sections/offerings before their parents are chosen", () => {
    renderBrowser();
    expect(requestedPaths.some((p) => p.startsWith("/sections"))).toBe(false);
    expect(requestedPaths.some((p) => p.startsWith("/course-offerings"))).toBe(false);
  });

  it("labels the semester select as a plain 'all semesters' filter until a trade is picked", () => {
    const html = renderBrowser();
    expect(selectTrigger(html, "Semester")).toContain("All semesters");
  });

  it("keeps sections disabled until an academic year is chosen", () => {
    const html = renderBrowser();
    expect(selectTrigger(html, "Section")).toContain("disabled");
    expect(selectTrigger(html, "Section")).toContain("Select academic year first");
  });

  it("keeps course offerings disabled until a section is chosen", () => {
    const html = renderBrowser();
    expect(selectTrigger(html, "Course offering")).toContain("disabled");
    expect(selectTrigger(html, "Course offering")).toContain("Select section first");
  });

  it("shows the read-only empty state before an offering is picked", () => {
    const html = renderBrowser();
    expect(html).toContain("Select a course offering");
    // No admin write controls on this route.
    expect(html).not.toMatch(/Take Attendance/i);
  });
});
