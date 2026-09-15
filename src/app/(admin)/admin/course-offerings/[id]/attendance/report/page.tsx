import { redirect } from "next/navigation";

/**
 * Legacy URL: take/report now live as tabs on the unified attendance page.
 * Kept as a redirect so bookmarks and old links don't break.
 */
export default function AdminAttendanceReportRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/course-offerings/${params.id}/attendance?tab=report`);
}
