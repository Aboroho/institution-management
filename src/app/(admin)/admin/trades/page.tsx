"use client";
import { CrudPage } from "@/components/crud";
import { Badge } from "@/components/ui";

export default function TradesPage() {
  return (
    <CrudPage
      title="Trades" subtitle="Departments such as Electronics or Computer Science." resource="trades"
      detailHref={(r) => `/admin/trades/${r.id}`}
      columns={[
        { key: "name", header: "Name" },
        { key: "code", header: "Code" },
        { key: "description", header: "Description", render: (r) => <span className="text-slate-500">{String(r.description ?? "—").slice(0, 60)}</span> },
      ]}
      badge={(r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>)}
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Computer Science" },
        { name: "code", label: "Code", required: true, placeholder: "CSE" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "isActive", label: "Active", type: "checkbox" },
      ]}
    />
  );
}
