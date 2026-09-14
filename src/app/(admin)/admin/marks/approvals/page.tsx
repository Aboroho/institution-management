import { redirect } from "next/navigation";

/**
 * Canonical, discoverable URL for the mark approval queue.
 * The existing marks screen owns the shared table and is opened on its
 * approvals tab to avoid maintaining two copies of the workflow UI.
 */
export default function MarkApprovalsPage() {
  redirect("/admin/marks?tab=approvals");
}
