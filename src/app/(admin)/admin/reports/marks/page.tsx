"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, SearchableSelect, Label, Breadcrumbs, Card, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function MarksReportPage() {
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");
  const [run, setRun] = useState("");
  const { data, error, isLoading, mutate } = useSWR(run ? `rep-marks${run}` : null, () => get<Row[]>(`/reports/marks${run}`).then((r) => r.data));
  const rows = data ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Reports", href: "/admin/reports" }, { label: "Marks" }]} />
      <PageHeader title="Marks report" />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="md:col-span-2"><Label>Course offering</Label><SearchableSelect options={offerings} value={offeringId} onChange={setOfferingId} clearLabel="All" /></div>
          <div className="flex items-end"><Button onClick={() => setRun(qs({ courseOfferingId: offeringId || undefined }))}>Run report</Button></div>
        </div>
      </Card>
      {!run ? <EmptyState title="Run the report to see results" /> :
        isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Report failed" onRetry={() => mutate()} /> : rows.length === 0 ? <EmptyState title="No marks found" /> : (
        <Table headers={["Student", "Course", "Assessment", "Mark", "Total", "%", "Result"]}>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-3">{str(r.name)} <span className="text-xs text-slate-400">{str(r.studentCode)}</span></td>
              <td className="px-4 py-3 text-sm">{str(r.course)} · {str(r.section)}</td>
              <td className="px-4 py-3 text-sm">{str(r.assessmentTitle)}</td>
              <td className="px-4 py-3 font-bold">{str(r.marksObtained)}</td>
              <td className="px-4 py-3">{str(r.totalMarks)}</td>
              <td className="px-4 py-3">{str(r.percentage)}%</td>
              <td className="px-4 py-3">{r.pass ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
