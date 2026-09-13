"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, Table, LoadingSkeleton, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TradeDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const { data, error, isLoading, mutate } = useSWR(`trade-${params.id}`, () => get<Row>(`/trades/${params.id}`).then((r) => r.data));
  if (isLoading) return <><PageHeader title="Trade" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Trade" /><ErrorState message="Failed to load trade" onRetry={() => mutate()} /></>;

  const semesters = (data.semesters as Row[] | undefined) ?? [];
  const sections = (data.sections as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Trades", href: "/admin/trades" }, { label: str(data.name) }]} />
      <PageHeader title={`${str(data.name)} (${str(data.code)})`} subtitle={str(data.description ?? "")} />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "semesters", label: `Semesters (${semesters.length})` }, { id: "sections", label: `Sections (${sections.length})` }]} active={tab} onChange={setTab} />
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5"><p className="text-sm text-slate-500">Status</p><p className="mt-1">{data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Course offerings</p><p className="mt-1 text-2xl font-bold">{str((data._count as Row)?.offerings ?? 0)}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Enrollments</p><p className="mt-1 text-2xl font-bold">{str((data._count as Row)?.enrollments ?? 0)}</p></Card>
        </div>
      )}
      {tab === "semesters" && (
        <Table headers={["Number", "Name", "Status"]}>
          {semesters.map((s) => <tr key={str(s.id)}><td className="px-4 py-3">{str(s.number)}</td><td className="px-4 py-3">{str(s.name)}</td><td className="px-4 py-3">{s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td></tr>)}
        </Table>
      )}
      {tab === "sections" && (
        <Table headers={["Section", "Year", "Semester"]}>
          {sections.map((s) => <tr key={str(s.id)}><td className="px-4 py-3"><Link href={`/admin/sections/${s.id}`} className="text-brand-600 hover:underline">{str(s.name)}</Link></td><td className="px-4 py-3 text-sm">{str(s.academicYearId).slice(0, 8)}</td><td className="px-4 py-3 text-sm">{str(s.semesterId).slice(0, 8)}</td></tr>)}
        </Table>
      )}
    </div>
  );
}
