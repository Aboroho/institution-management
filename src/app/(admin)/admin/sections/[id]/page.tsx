"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, Table, LoadingSkeleton, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function SectionDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const { data, error, isLoading, mutate } = useSWR(`section-${params.id}`, () => get<Row>(`/sections/${params.id}`).then((r) => r.data));
  const { data: enrollments } = useSWR(tab === "students" ? `sec-en-${params.id}` : null, () => get<Row[]>(`/enrollments?sectionId=${params.id}&status=ACTIVE&limit=100`).then((r) => r.data));
  if (isLoading) return <><PageHeader title="Section" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Section" /><ErrorState message="Failed to load section" onRetry={() => mutate()} /></>;

  const offerings = (data.offerings as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Sections", href: "/admin/sections" }, { label: str(data.name) }]} />
      <PageHeader title={`Section ${str(data.name)}`} subtitle={`${str((data.academicYear as Row)?.name)} · ${str((data.trade as Row)?.name)} · ${str((data.semester as Row)?.name)} · ${str((data.shift as Row)?.name)}`} />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "students", label: "Students" }, { id: "offerings", label: `Offerings (${offerings.length})` }]} active={tab} onChange={setTab} />
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5"><p className="text-sm text-slate-500">Status</p><p className="mt-1">{data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Capacity</p><p className="mt-1 text-2xl font-bold">{str(data.capacity ?? "—")}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Enrollments</p><p className="mt-1 text-2xl font-bold">{str((data._count as Row)?.enrollments ?? 0)}</p></Card>
        </div>
      )}
      {tab === "students" && (
        <Table headers={["Roll", "Student ID", "Name", "Status"]}>
          {(enrollments ?? []).map((e) => <tr key={str(e.id)}><td className="px-4 py-3 font-medium">{str(e.rollNumber)}</td><td className="px-4 py-3"><Link href={`/admin/students/${(e.student as Row)?.id}`} className="text-brand-600 hover:underline">{str((e.student as Row)?.studentId)}</Link></td><td className="px-4 py-3">{str(((e.student as Row)?.user as Row)?.name) ?? str(((e.student as Row)?.user as Row)?.name)}</td><td className="px-4 py-3"><Badge tone="green">{str(e.status)}</Badge></td></tr>)}
        </Table>
      )}
      {tab === "offerings" && (
        <Table headers={["Course", "Code"]}>
          {offerings.map((o) => <tr key={str(o.id)}><td className="px-4 py-3"><Link href={`/admin/course-offerings/${o.id}`} className="text-brand-600 hover:underline">{str((o.course as Row)?.title)}</Link></td><td className="px-4 py-3">{str((o.course as Row)?.code)}</td></tr>)}
        </Table>
      )}
    </div>
  );
}
