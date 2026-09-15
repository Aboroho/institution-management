import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The centralized teacher-assignment workflow moved to /admin/teacher-assignment.
// This legacy URL keeps working for existing bookmarks / links.
export default function TeacherAssignmentsLegacy() {
  redirect("/admin/teacher-assignment");
}
