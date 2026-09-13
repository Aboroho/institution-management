"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, Table, LoadingSkeleton, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function CourseDetail({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState("overview");
  const { data, error, isLoading, mutate } = useSWR(`course-${params.id}`, () => get<Row>(`/courses/${params.id}`).then((r) => r.data));
  if (isLoading) return <><PageHeader title="Course" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Course" /><ErrorState message="Failed to load course" onRetry={() => mutate()} /></>;

  const curricula = (data.curriculumCourses as Row[] | undefined) ?? [];
  const offerings = (data.offerings as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Courses", href: "/admin/courses" }, { label: str(data.code) }]} />
      <PageHeader title={`${str(data.code)} — ${str(data.title)}`} subtitle={str(data.description ?? "")} />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "curricula", label: `Curriculum usage (${curricula.length})` }, { id: "offerings", label: `Offerings (${offerings.length})` }]} active={tab} onChange={setTab} />
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5"><p className="text-sm text-slate-500">Status</p><p className="mt-1">{data.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Credits</p><p className="mt-1 text-2xl font-bold">{str(data.credits ?? "—")}</p></Card>
          <Card className="p-5"><p className="text-sm text-slate-500">Reusable</p><p className="mt-1 text-sm">Shared across academic years — never duplicated per year.</p></Card>
        </div>
      )}
      {tab === "curricula" && (
        <Table headers={["Curriculum", "Trade", "Semester"]}>
          {curricula.map((c) => <tr key={str(c.id)}><td className="px-4 py-3"><Link href={`/admin/curricula/${(c.curriculum as Row)?.id}`} className="text-brand-600 hover:underline">{str((c.curriculum as Row)?.name)}</Link></td><td className="px-4 py-3">{str(((c.curriculum as Row)?.trade as Row)?.name)}</td><td className="px-4 py-3">{str(((c.curriculum as Row)?.semester as Row)?.name)}</td></tr>)}
        </Table>
      )}
      {tab === "offerings" && (
        <Table headers={["Year", "Trade", "Semester", "Section"]}>
          {offerings.map((o) => <tr key={str(o.id)}><td className="px-4 py-3"><Link href={`/admin/course-offerings/${o.id}`} className="text-brand-600 hover:underline">{str((o.academicYear as Row)?.name)}</Link></td><td className="px-4 py-3">{str((o.trade as Row)?.name)}</td><td className="px-4 py-3">{str((o.semester as Row)?.name)}</td><td className="px-4 py-3">{str((o.section as Row)?.name)}</td></tr>)}
        </Table>
      )}
    </div>
  );
}
