"use client";
import { CrudPage } from "@/components/crud";
import { Badge } from "@/components/ui";

export default function CoursesPage() {
  return (
    <CrudPage
      title="Courses" subtitle="Reusable subjects — never duplicated per year." resource="courses"
      detailHref={(r) => `/admin/courses/${r.id}`}
      columns={[
        { key: "code", header: "Code" },
        { key: "title", header: "Title" },
        { key: "credits", header: "Credits", render: (r) => String(r.credits ?? "—") },
      ]}
      badge={(r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>)}
      fields={[
        { name: "code", label: "Course code", required: true, placeholder: "CSE-101" },
        { name: "title", label: "Title", required: true, placeholder: "Programming Fundamentals" },
        { name: "credits", label: "Credits", type: "number" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "isActive", label: "Active", type: "checkbox" },
      ]}
    />
  );
}
