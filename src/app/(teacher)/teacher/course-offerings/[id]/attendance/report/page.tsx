import { redirect } from "next/navigation";

/**
 * Legacy URL: take/report now live as tabs on the unified attendance page.
 * Kept as a redirect so bookmarks and old links don't break.
 */
export default function TeacherAttendanceReportRedirect({ params }: { params: { id: string } }) {
  redirect(`/teacher/course-offerings/${params.id}?tab=complete-attendance`);
}
