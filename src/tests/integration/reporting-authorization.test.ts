import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { forbidden } from "@/lib/errors/errors";

// Mock authentication and permissions to verify authorization flow and IDOR prevention
const authMock = vi.hoisted(() => ({
  user: {
    userId: "user-1",
    role: "TEACHER" as "ADMIN" | "TEACHER" | "STUDENT",
    email: "teacher@test.local",
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(async () => authMock.user),
}));

vi.mock("@/lib/permissions/permissions", () => ({
  requireActiveTeacherAssignment: vi.fn(async (auth, courseOfferingId) => {
    if (auth.role === "ADMIN") return { isAdmin: true };
    if (auth.role === "TEACHER" && courseOfferingId === "co-authorized") {
      return { isAdmin: false };
    }
    throw forbidden("You are not assigned to this course offering");
  }),
  requireStudentSelf: vi.fn(async (auth, studentId) => {
    if (auth.role === "ADMIN") return { isAdmin: true };
    if (auth.role === "STUDENT" && studentId === "st-own") {
      return { isAdmin: false };
    }
    throw forbidden("You can only access your own data");
  }),
  requireStudentInOffering: vi.fn(async (auth, courseOfferingId) => {
    if (auth.role === "ADMIN") return;
    if (courseOfferingId !== "co-authorized") {
      throw forbidden("You are not enrolled in this course offering");
    }
  }),
}));

// Mock reporting service so we isolate authorization checks
vi.mock("@/modules/reporting/reporting.service", () => ({
  generateCourseOfferingAttendanceReport: vi.fn(async (id) => ({
    type: "course-offering-attendance",
    metadata: { courseOfferingId: id },
  })),
  generateStudentAttendanceReport: vi.fn(async (id) => ({
    type: "student-attendance",
    metadata: { studentId: id },
  })),
  generateCourseOfferingAssessmentReport: vi.fn(async (id) => ({
    type: "course-offering-assessment",
    metadata: { courseOfferingId: id },
  })),
  generateStudentSemesterMarksReport: vi.fn(async (id) => ({
    type: "student-semester-marks",
    metadata: { studentId: id },
  })),
}));

describe("Reporting API Authorization & Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("CourseOffering Attendance: rejects teacher requesting unauthorized course offering", async () => {
    const { GET } = await import(
      "@/app/api/v1/reports/attendance/course-offerings/[courseOfferingId]/route"
    );
    authMock.user = { userId: "teacher-1", role: "TEACHER", email: "teacher@test.com" };

    const req = new NextRequest("http://localhost:3000/api/v1/reports/attendance/course-offerings/co-unauthorized");
    const res = await GET(req, { params: { courseOfferingId: "co-unauthorized" } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("FORBIDDEN");
  });

  it("CourseOffering Attendance: permits teacher requesting authorized course offering", async () => {
    const { GET } = await import(
      "@/app/api/v1/reports/attendance/course-offerings/[courseOfferingId]/route"
    );
    authMock.user = { userId: "teacher-1", role: "TEACHER", email: "teacher@test.com" };

    const req = new NextRequest("http://localhost:3000/api/v1/reports/attendance/course-offerings/co-authorized");
    const res = await GET(req, { params: { courseOfferingId: "co-authorized" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.type).toBe("course-offering-attendance");
  });

  it("Student Attendance: prevents IDOR when a student requests another student's report", async () => {
    const { GET } = await import(
      "@/app/api/v1/reports/attendance/students/[studentId]/route"
    );
    authMock.user = { userId: "user-victim", role: "STUDENT", email: "victim@test.com" };

    // Requesting someone else's ID: st-other
    const req = new NextRequest("http://localhost:3000/api/v1/reports/attendance/students/st-other");
    const res = await GET(req, { params: { studentId: "st-other" } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toContain("only access your own data");
  });

  it("Student Attendance: allows a student to fetch their own report", async () => {
    const { GET } = await import(
      "@/app/api/v1/reports/attendance/students/[studentId]/route"
    );
    authMock.user = { userId: "user-student", role: "STUDENT", email: "student@test.com" };

    const req = new NextRequest("http://localhost:3000/api/v1/reports/attendance/students/st-own");
    const res = await GET(req, { params: { studentId: "st-own" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.type).toBe("student-attendance");
  });

  it("Student Semester Marks: prevents IDOR for another student's marks", async () => {
    const { GET } = await import(
      "@/app/api/v1/reports/marks/students/[studentId]/route"
    );
    authMock.user = { userId: "user-student", role: "STUDENT", email: "student@test.com" };

    const req = new NextRequest("http://localhost:3000/api/v1/reports/marks/students/st-other");
    const res = await GET(req, { params: { studentId: "st-other" } });
    expect(res.status).toBe(403);
  });

  it("Admin can access reports for any student or course offering", async () => {
    authMock.user = { userId: "admin-1", role: "ADMIN", email: "admin@test.com" };

    const { GET: getCoAtt } = await import(
      "@/app/api/v1/reports/attendance/course-offerings/[courseOfferingId]/route"
    );
    const reqCo = new NextRequest("http://localhost:3000/api/v1/reports/attendance/course-offerings/any-id");
    const resCo = await getCoAtt(reqCo, { params: { courseOfferingId: "any-id" } });
    expect(resCo.status).toBe(200);

    const { GET: getStAtt } = await import(
      "@/app/api/v1/reports/attendance/students/[studentId]/route"
    );
    const reqSt = new NextRequest("http://localhost:3000/api/v1/reports/attendance/students/any-student-id");
    const resSt = await getStAtt(reqSt, { params: { studentId: "any-student-id" } });
    expect(resSt.status).toBe(200);
  });
});
