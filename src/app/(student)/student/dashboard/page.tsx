"use client";
import useSWR from "swr";
import Link from "next/link";
import { BookOpen, ClipboardCheck, FileText, Megaphone } from "lucide-react";
import { get, authApi } from "@/lib/api/client";
import { PageHeader, StatCard, Card, LoadingSkeleton, ErrorState, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentDashboard() {
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const { data, error, isLoading, mutate } = useSWR("st-dash", () => get<Row>("/reports/student-dashboard").then((r) => r.data));
  const { data: assessments } = useSWR("st-dash-assess", () => get<Row[]>("/assessments?limit=100").then((r) => r.data));
  const { data: notices } = useSWR("st-dash-not", () => get<Row[]>("/notices?limit=5").then((r) => r.data));

  if (isLoading) return <><PageHeader title="Dashboard" /><LoadingSkeleton rows={6} /></>;
  if (error || !data) return <><PageHeader title="Dashboard" /><ErrorState message="Failed to load dashboard" onRetry={() => mutate()} /></>;

  const att = (data.attendance as Row) ?? {};
  const enrollments = (data.enrollments as Row[] | undefined) ?? [];
  const current = enrollments[0];
  const upcoming = (assessments ?? []).filter((a) => a.dueDate && new Date(str(a.dueDate)) >= new Date()).slice(0, 5);

  return (
    <div>
      <PageHeader title={`Welcome, ${me?.name ?? "Student"}`} subtitle={current ? `${str((current.academicYear as Row)?.name)} · ${str((current.trade as Row)?.name)} · ${str((current.semester as Row)?.name)} · Section ${str((current.section as Row)?.name)}` : "No active enrollment"} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attendance" value={`${str(att.percentage ?? 0)}%`} hint={`${str(att.present ?? 0)} present · ${str(att.absent ?? 0)} absent · ${str(att.late ?? 0)} late`} icon={<ClipboardCheck size={20} />} tone="green" />
        <StatCard label="Enrolled courses" value={enrollments.length} icon={<BookOpen size={20} />} tone="blue" />
        <StatCard label="Upcoming assessments" value={upcoming.length} icon={<FileText size={20} />} tone="amber" />
        <StatCard label="Notices" value={(notices ?? []).length} icon={<Megaphone size={20} />} tone="violet" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Upcoming assessments</h2>
          {upcoming.length === 0 ? <p className="text-sm text-slate-500">Nothing due soon.</p> : (
            <div className="space-y-2">
              {upcoming.map((a) => (
                <Link key={str(a.id)} href={`/student/assessments/${a.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 hover:bg-slate-100">
                  <span className="text-sm font-medium">{str(a.title)} <span className="text-xs font-normal text-slate-400">· {str(((a.courseOffering as Row)?.course as Row)?.title)}</span></span>
                  <Badge tone="amber">{str(a.dueDate).slice(0, 10)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Recent notices</h2>
          {(notices ?? []).length === 0 ? <p className="text-sm text-slate-500">No notices.</p> : (
            <div className="space-y-2">
              {(notices ?? []).map((n) => (
                <div key={str(n.id)} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-medium">{str(n.title)}</p>
                  <p className="text-xs text-slate-500">{str(((n.courseOffering as Row)?.course as Row)?.title)} · {str(n.publishedAt).slice(0, 10)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
