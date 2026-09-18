export type NotificationViewerRole = "ADMIN" | "TEACHER" | "STUDENT";

/**
 * Notification navigation is centralized so resource IDs are never discarded
 * by individual portal pages. Notice links include the notification ID; the
 * notice details page uses it to perform the authenticated, idempotent read.
 */
export function notificationHref(notification: {
  id: string;
  type?: string;
  resourceType?: string | null;
  resourceId?: string | null;
}, role: NotificationViewerRole): string | null {
  const resourceType = notification.resourceType ?? "";
  const resourceId = notification.resourceId ?? "";
  if (!resourceId) {
    if (notification.type === "PENDING_APPROVAL" && role === "ADMIN") return "/admin/attendance/approvals";
    return null;
  }

  if (resourceType === "Notice") return `/${role.toLowerCase()}/notices/${encodeURIComponent(resourceId)}?notification=${encodeURIComponent(notification.id)}`;
  if (resourceType === "Assessment") {
    if (role === "STUDENT") return `/student/assessments/${encodeURIComponent(resourceId)}`;
    return role === "ADMIN" ? "/admin/assessments" : "/teacher/course-offerings";
  }
  if (resourceType === "AttendanceChangeRequest" && role === "ADMIN") return "/admin/attendance/approvals";
  if (resourceType === "AssessmentMarkChangeRequest" && role === "ADMIN") return "/admin/marks/approvals";
  if (resourceType === "StudentPromotion" && role === "STUDENT") return "/student/dashboard";
  return null;
}
