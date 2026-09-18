import { describe, expect, it } from "vitest";
import { notificationHref } from "@/lib/notifications/links";

describe("notification resource links", () => {
  it("links a notice notification to the exact notice and notification id", () => {
    expect(notificationHref({ id: "notification-1", resourceType: "Notice", resourceId: "notice-42" }, "STUDENT"))
      .toBe("/student/notices/notice-42?notification=notification-1");
  });

  it("keeps approval navigation scoped to the admin portal", () => {
    expect(notificationHref({ id: "n-1", type: "PENDING_APPROVAL", resourceType: "AttendanceChangeRequest", resourceId: "request-1" }, "ADMIN"))
      .toBe("/admin/attendance/approvals");
    expect(notificationHref({ id: "n-2", type: "PENDING_APPROVAL" }, "STUDENT")).toBeNull();
  });

  it("does not invent a destination when a notification has no stable resource", () => {
    expect(notificationHref({ id: "n-3", type: "SYSTEM_NOTIFICATION" }, "TEACHER")).toBeNull();
  });
});
