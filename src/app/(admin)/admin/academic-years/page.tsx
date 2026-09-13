"use client";
import { CrudPage } from "@/components/crud";
import { Badge } from "@/components/ui";

export default function AcademicYearsPage() {
  return (
    <CrudPage
      title="Academic Years" subtitle="Historical years are archived, never deleted." resource="academic-years"
      columns={[
        { key: "name", header: "Name" },
        { key: "startDate", header: "Start", render: (r) => String(r.startDate).slice(0, 10) },
        { key: "endDate", header: "End", render: (r) => String(r.endDate).slice(0, 10) },
      ]}
      badge={(r) => <span className="flex gap-1">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}{r.isArchived ? <Badge tone="amber">Archived</Badge> : null}</span>}
      fields={[
        { name: "name", label: "Name (e.g. 2026-27)", required: true, placeholder: "2026-27" },
        { name: "startDate", label: "Start date", type: "date", required: true },
        { name: "endDate", label: "End date", type: "date", required: true },
        { name: "isActive", label: "Set as active year", type: "checkbox" },
        { name: "isArchived", label: "Archived", type: "checkbox" },
      ]}
    />
  );
}
