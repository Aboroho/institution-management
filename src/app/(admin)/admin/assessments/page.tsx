"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Table, TableSkeleton, EmptyState, ErrorState, Select, SearchableSelect, Label, Pagination, Breadcrumbs, Badge, Card } from "@/components/ui";
import { CourseOfferingCell } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminAssessmentsPage() {
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const query = qs({ page, limit: 25, courseOfferingId: offeringId || undefined, type: type || undefined });
  const { data, error, isLoading, mutate } = useSWR(`admin-assess${query}`, () => get<Row[]>(`/assessments${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Assessments" }]} />
      <PageHeader title="Assessments" subtitle="All assessments across offerings. Teachers manage their own." />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div><Label>Course offering</Label><SearchableSelect options={offerings} value={offeringId} onChange={(v) => { setOfferingId(v); setPage(1); }} clearLabel="All" /></div>
          <div><Label>Type</Label><Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All</option>{["ASSIGNMENT", "CLASS_TEST", "MIDTERM", "FINAL_EXAM", "PRACTICAL", "QUIZ", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
        </div>
      </Card>
      {isLoading ? <TableSkeleton columns={9} rows={6} label="Loading assessments" /> : error ? <ErrorState message="Failed to load assessments" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No assessments" /> : (
        <>
          <Table headers={["Title", "Course", "Type", "Total", "Due", "Submitable", "Counts", "Submissions", "Marks"]}>
            {items.map((a) => (
              <tr key={str(a.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{str(a.title)}</td>
                <td className="px-4 py-3 text-sm"><CourseOfferingCell offering={a.courseOffering as Row} /></td>
                <td className="px-4 py-3"><Badge tone="blue">{str(a.type)}</Badge></td>
                <td className="px-4 py-3">{str(a.totalMarks)}</td>
                <td className="px-4 py-3 text-sm">{a.dueDate ? str(a.dueDate).slice(0, 10) : "—"}</td>
                <td className="px-4 py-3">{a.submitable ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
                <td className="px-4 py-3">{a.countsTowardFinal ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
                <td className="px-4 py-3">{str(((a._count as Row)?.submissions) ?? 0)}</td>
                <td className="px-4 py-3">{str(((a._count as Row)?.marks) ?? 0)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
