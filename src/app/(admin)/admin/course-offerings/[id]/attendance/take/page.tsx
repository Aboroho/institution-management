import { redirect } from "next/navigation";

/**
 * Admins must never take attendance. This legacy URL now lands on the
 * read-only Attendance Report so old bookmarks don't break.
 */
export default function AdminTakeAttendanceRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/course-offerings/${params.id}/attendance?tab=report`);
}
