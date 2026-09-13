"use client";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { PageHeader, Card, Table, LoadingSkeleton, ErrorState, Breadcrumbs, StatusBadge, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentReportPage({ params }: { params: { id: string } }) {
  const { data, error, isLoading, mutate } = useSWR(`student-report-${params.id}`, () => get<Row>(`/reports/students/${params.id}`).then((r) => r.data));

  if (isLoading) return <><PageHeader title="Student report" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Student report" /><ErrorState message="Failed to load report" onRetry={() => mutate()} /></>;

  const student = data.student as Row;
  const enrollments = (student.enrollments as Row[] | undefined) ?? [];
  const byOffering = (data.byOffering as Row[] | undefined) ?? [];
  const finals = (data.finals as Row[] | undefined) ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Students", href: "/admin/students" }, { label: str((student.user as Row)?.name) }]} />
      <PageHeader title={str((student.user as Row)?.name)} subtitle={`Student ID: ${str(student.studentId)} · ${str((student.user as Row)?.email)}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Enrollment history</h2>
          <Table headers={["Year", "Trade", "Semester", "Section", "Status"]}>
            {enrollments.map((e) => (
              <tr key={str(e.id)}>
                <td className="px-4 py-2 text-sm">{str((e.academicYear as Row)?.name)}</td>
                <td className="px-4 py-2 text-sm">{str((e.trade as Row)?.code)}</td>
                <td className="px-4 py-2 text-sm">{str((e.semester as Row)?.name)}</td>
                <td className="px-4 py-2 text-sm">{str((e.section as Row)?.name)}</td>
                <td className="px-4 py-2"><StatusBadge status={str(e.status)} /></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Attendance by course</h2>
          {byOffering.length === 0 ? <p className="text-sm text-slate-500">No attendance records.</p> : (
            <Table headers={["Course", "Total", "P", "A", "L", "E"]}>
              {byOffering.map((a, i) => (
                <tr key={i}><td className="px-4 py-2 text-sm">{str(a.course)}</td><td className="px-4 py-2">{str(a.total)}</td><td className="px-4 py-2">{str(a.present)}</td><td className="px-4 py-2">{str(a.absent)}</td><td className="px-4 py-2">{str(a.late)}</td><td className="px-4 py-2">{str(a.excused)}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Final grades</h2>
        {finals.length === 0 ? <p className="text-sm text-slate-500">No graded assessments.</p> : (
          <Table headers={["Course", "Obtained", "Possible", "%", "Grade", "Passed"]}>
            {finals.map((f) => {
              const fin = f.final as Row;
              return (
                <tr key={str(f.offeringId)}>
                  <td className="px-4 py-2">{str(f.course)}</td>
                  <td className="px-4 py-2">{str(fin.totalObtained)}</td>
                  <td className="px-4 py-2">{str(fin.totalPossible)}</td>
                  <td className="px-4 py-2 font-bold">{str(fin.percentage)}%</td>
                  <td className="px-4 py-2"><Badge tone="blue">{str(fin.grade)}</Badge></td>
                  <td className="px-4 py-2">{fin.passed ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
