"use client";
import { CrudPage } from "@/components/crud";
import { Badge } from "@/components/ui";

export default function ShiftsPage() {
  return (
    <CrudPage
      title="Shifts" subtitle="Institution-configurable shifts (morning, day, evening, ...)." resource="shifts"
      columns={[
        { key: "name", header: "Name" },
        { key: "code", header: "Code" },
        { key: "startTime", header: "Start", render: (r) => String(r.startTime ?? "—") },
        { key: "endTime", header: "End", render: (r) => String(r.endTime ?? "—") },
      ]}
      badge={(r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>)}
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Morning" },
        { name: "code", label: "Code", required: true, placeholder: "MORNING" },
        { name: "startTime", label: "Start time (HH:mm)", placeholder: "08:00" },
        { name: "endTime", label: "End time (HH:mm)", placeholder: "12:00" },
        { name: "isActive", label: "Active", type: "checkbox" },
      ]}
    />
  );
}
