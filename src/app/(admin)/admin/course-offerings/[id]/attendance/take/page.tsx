import { redirect } from "next/navigation";

/**
 * Legacy URL. Admins are read-only for attendance (product decision
 * 2026-09-15), so the old take-attendance bookmark lands on the read-only
 * report instead of a take form.
 */
export default function AdminTakeAttendanceRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/course-offerings/${params.id}/attendance?tab=report`);
}
