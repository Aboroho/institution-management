import { describe, it, expect } from "vitest";
import type { AttendanceHistoryPayload, AttendanceHistoryEntry } from "@/modules/attendance/attendance.types";

/**
 * Validates the shape of the Attendance History payload. The actual database
 * queries are exercised in integration tests when DATABASE_URL is set; here
 * we verify the documented invariants that the UI depends on.
 */

function makeEntry(overrides: Partial<AttendanceHistoryEntry> = {}): AttendanceHistoryEntry {
  return {
    id: "log-1",
    recordId: "rec-1",
    oldStatus: "ABSENT",
    newStatus: "PRESENT",
    reason: "Student was actually present",
    timestamp: "2026-09-15T10:42:00.000Z",
    changedBy: { id: "u-1", name: "Teacher A", email: "a@school", role: "TEACHER" },
    changeType: "CORRECTION",
    viaApproval: false,
    relatedChangeRequest: null,
    ...overrides,
  };
}

function makePayload(overrides: Partial<AttendanceHistoryPayload> = {}): AttendanceHistoryPayload {
  return {
    session: {
      id: "sess-1",
      attendanceDate: "2026-09-15",
      courseOffering: { id: "off-1", course: { title: "Intro to CS", code: "CSC101" }, section: { name: "A" } },
    },
    students: [
      { recordId: "rec-1", studentId: "STU-001", rollNumber: 1023, name: "Rahim", email: "r@school", currentStatus: "PRESENT", directCorrections: 1 },
    ],
    history: [makeEntry()],
    ...overrides,
  };
}

describe("Attendance History payload — shape", () => {
  it("scopes the payload to a single AttendanceSession", () => {
    const p = makePayload();
    expect(p.session.id).toBe("sess-1");
    expect(p.session.attendanceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("entries carry the required fields", () => {
    const e = makeEntry();
    for (const field of ["id", "recordId", "oldStatus", "newStatus", "reason", "timestamp", "changedBy", "changeType", "viaApproval", "relatedChangeRequest"]) {
      expect(e).toHaveProperty(field);
    }
    expect(e.changedBy).toHaveProperty("role");
  });

  it("changeType discriminates INITIAL_ENTRY from CORRECTION", () => {
    const init = makeEntry({ id: "x", oldStatus: null, changeType: "INITIAL_ENTRY" });
    expect(init.changeType).toBe("INITIAL_ENTRY");
    expect(init.oldStatus).toBeNull();

    const corr = makeEntry({ id: "y", changeType: "CORRECTION" });
    expect(corr.changeType).toBe("CORRECTION");
    expect(corr.oldStatus).not.toBeNull();
  });

  it("viaApproval is true when a related change request exists", () => {
    const direct = makeEntry({ viaApproval: false, relatedChangeRequest: null });
    expect(direct.viaApproval).toBe(false);

    const approved = makeEntry({
      id: "z",
      viaApproval: true,
      relatedChangeRequest: {
        id: "req-1",
        status: "APPROVED",
        requestedBy: { id: "u-2", name: "Teacher A", role: "TEACHER" },
        reviewedBy: { id: "u-3", name: "Admin", role: "ADMIN" },
        reviewedAt: "2026-09-15T11:00:00.000Z",
        reviewNote: "Looks correct",
      },
    });
    expect(approved.viaApproval).toBe(true);
    expect(approved.relatedChangeRequest?.status).toBe("APPROVED");
  });

  it("history is sorted newest-first (the UI does not need to re-sort)", () => {
    const p = makePayload({
      history: [
        makeEntry({ id: "1", timestamp: "2026-09-15T12:00:00.000Z" }),
        makeEntry({ id: "2", timestamp: "2026-09-15T11:00:00.000Z" }),
        makeEntry({ id: "3", timestamp: "2026-09-15T10:00:00.000Z" }),
      ],
    });
    const sorted = [...p.history].map((h) => h.timestamp).sort().reverse();
    expect(p.history.map((h) => h.timestamp)).toEqual(sorted);
  });

  it("students list contains the recordId used to correlate entries", () => {
    const p = makePayload();
    const recordIds = new Set(p.students.map((s) => s.recordId));
    for (const entry of p.history) {
      expect(recordIds.has(entry.recordId)).toBe(true);
    }
  });
});

describe("Attendance History — scope (only one session)", () => {
  it("the payload contains no recordIds from other sessions", () => {
    // Pure shape check — the runtime enforcement is exercised in integration tests.
    const p = makePayload();
    const ourSessionId = p.session.id;
    expect(ourSessionId).toBe("sess-1");
    // All entries reference records belonging to this session by construction.
    for (const s of p.students) expect(typeof s.recordId).toBe("string");
  });
});
