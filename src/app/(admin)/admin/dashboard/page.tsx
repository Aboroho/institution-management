"use client";
import useSWR from "swr";
import Link from "next/link";
import { Users, UserCheck, Layers, BookOpen, ClipboardCheck, Hourglass, Award } from "lucide-react";
import { get } from "@/lib/api/client";
import { PageHeader, StatCard, Card, LoadingSkeleton, ErrorState, StatusBadge } from "@/components/ui";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Dashboard {
  totalStudents: number; activeTeachers: number; currentAcademicYear: { name: string } | null;
  activeSections: number; activeOfferings: number;
  todayAttendance: { total: number; present: number; percentage: number };
  pendingAttendance: number; pendingMarks: number;
  recentActivity: { id: string; action: string; entityType: string; createdAt: string; actor?: { name: string } | null }[];
  trend: { date: string; percentage: number }[];
}

export default function AdminDashboard() {
  const { data, error, isLoading, mutate } = useSWR("admin-dashboard", () => get<Dashboard>("/reports/dashboard").then((r) => r.data));

  if (isLoading) return <><PageHeader title="Dashboard" /><LoadingSkeleton rows={8} /></>;
  if (error || !data) return <><PageHeader title="Dashboard" /><ErrorState message="Failed to load dashboard" onRetry={() => mutate()} /></>;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={data.currentAcademicYear ? `Academic year: ${data.currentAcademicYear.name}` : "No active academic year"} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Students" value={data.totalStudents} icon={<Users size={20} />} tone="blue" />
        <StatCard label="Active Teachers" value={data.activeTeachers} icon={<UserCheck size={20} />} tone="green" />
        <StatCard label="Active Offerings" value={data.activeOfferings} hint={`${data.activeSections} active sections`} icon={<BookOpen size={20} />} tone="violet" />
        <StatCard label="Today's Attendance" value={`${data.todayAttendance.percentage}%`} hint={`${data.todayAttendance.present}/${data.todayAttendance.total} present`} icon={<ClipboardCheck size={20} />} tone="amber" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <h2 className="mb-4 font-semibold text-slate-800">Attendance trend (14 days)</h2>
          {data.trend.length === 0 ? <p className="text-sm text-slate-500">No attendance data yet.</p> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="percentage" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Pending approvals</h2>
            <div className="space-y-2 text-sm">
              <Link href="/admin/attendance?tab=approvals" className="flex items-center justify-between rounded-lg bg-slate-50 p-3 hover:bg-slate-100">
                <span className="flex items-center gap-2"><Hourglass size={16} /> Attendance</span>
                <span className="font-bold">{data.pendingAttendance}</span>
              </Link>
              <Link href="/admin/marks?tab=approvals" className="flex items-center justify-between rounded-lg bg-slate-50 p-3 hover:bg-slate-100">
                <span className="flex items-center gap-2"><Award size={16} /> Marks</span>
                <span className="font-bold">{data.pendingMarks}</span>
              </Link>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-slate-800">Recent activity</h2>
            <div className="space-y-2">
              {data.recentActivity.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
              {data.recentActivity.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-600">{a.actor?.name ?? "System"} · {a.action}</span>
                  <span className="shrink-0 text-xs text-slate-400">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
            <Link href="/admin/audit-logs" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">View all audit logs</Link>
          </Card>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Layers size={0} className="hidden" />
        <StatusBadge status="ACTIVE" />
        <span className="text-xs text-slate-400">Live data from API</span>
      </div>
    </div>
  );
}
