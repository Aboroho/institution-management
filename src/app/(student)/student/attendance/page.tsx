"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, authApi } from "@/lib/api/client";
import { PageHeader, Card, Table, TableSkeleton, ErrorState, Breadcrumbs, EmptyState, Tabs } from "@/components/ui";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { StudentAttendanceReportView } from "@/components/reporting/student-attendance-report-view";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentAttendance() {
  const [tab, setTab] = useState("overview");
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const studentId = (me?.student as { id: string } | undefined)?.id;
  const { data, error, isLoading, mutate } = useSWR(studentId ? `st-att-${studentId}` : null, () => get<Row[]>(`/students/${studentId}/attendance`).then((r) => r.data));
  const items = data ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Attendance" }]} />
      <PageHeader title="My Attendance" subtitle="Your records only." />
      <Tabs
        tabs={[
          { id: "overview", label: "Attendance Overview" },
          { id: "report", label: "Attendance Report" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && (
        isLoading ? <TableSkeleton columns={7} rows={6} label="Loading attendance" /> : error ? <ErrorState message="Failed to load attendance" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No attendance records yet" /> : (
          <>
            <Card className="mb-4 p-5">
              <h2 className="mb-4 font-semibold">Attendance by course (%)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={items.map((a) => ({ course: str(((a.offering as Row)?.course as Row)?.title).slice(0, 18), pct: Number(a.percentage) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="course" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="pct" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Table headers={["Course", "Classes", "Present", "Absent", "Late", "Excused", "%"]}>
              {items.map((a) => <tr key={str((a.offering as Row)?.id)}><td className="px-4 py-3 font-medium">{str(((a.offering as Row)?.course as Row)?.title)}</td><td className="px-4 py-3">{str(a.total)}</td><td className="px-4 py-3">{str(a.present)}</td><td className="px-4 py-3">{str(a.absent)}</td><td className="px-4 py-3">{str(a.late)}</td><td className="px-4 py-3">{str(a.excused)}</td><td className="px-4 py-3 font-bold">{str(a.percentage)}%</td></tr>)}
            </Table>
          </>
        )
      )}

      {tab === "report" && studentId && (
        <StudentAttendanceReportView studentId={studentId} />
      )}
    </div>
  );
}
