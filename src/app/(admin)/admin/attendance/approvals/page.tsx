import { redirect } from "next/navigation";

/**
 * Canonical, discoverable URL for the attendance approval queue.
 * The existing attendance screen owns the shared table and is opened on its
 * approvals tab to avoid maintaining two copies of the workflow UI.
 */
export default function AttendanceApprovalsPage() {
  redirect("/admin/attendance?tab=approvals");
}
