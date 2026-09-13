"use client";
import useSWR from "swr";
import { get, authApi } from "@/lib/api/client";
import { PageHeader, Card, Table, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentMarks() {
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const studentId = (me?.student as { id: string } | undefined)?.id;
  const { data, error, isLoading, mutate } = useSWR(studentId ? `st-marks-${studentId}` : null, () => get<Row[]>(`/students/${studentId}/marks`).then((r) => r.data));
  const items = data ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Marks" }]} />
      <PageHeader title="My Marks" subtitle="Your results only. Final grades computed by the grading service." />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load marks" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No marks yet" /> : (
        <div className="space-y-4">
          {items.map((g) => {
            const fin = g.final as Row;
            return (
              <Card key={str((g.offering as Row)?.id)} className="p-4">
                <p className="mb-2 font-semibold">{str(((g.offering as Row)?.course as Row)?.title)} <span className="ml-2 text-sm font-normal text-slate-500">Final: {str(fin.percentage)}% · <Badge tone="blue">{str(fin.grade)}</Badge> {fin.passed ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}</span></p>
                <Table headers={["Assessment", "Type", "Obtained", "Total", "%"]}>
                  {((g.assessments as Row[]) ?? []).map((a) => (
                    <tr key={str(a.id)}>
                      <td className="px-4 py-2 text-sm">{str(a.title)}</td>
                      <td className="px-4 py-2"><Badge>{str(a.type)}</Badge></td>
                      <td className="px-4 py-2 font-medium">{a.marksObtained === null || a.marksObtained === undefined ? "—" : str(a.marksObtained)}</td>
                      <td className="px-4 py-2">{str(a.totalMarks)}</td>
                      <td className="px-4 py-2">{a.marksObtained === null || a.marksObtained === undefined ? "—" : `${Math.round((Number(a.marksObtained) / Number(a.totalMarks)) * 1000) / 10}%`}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
