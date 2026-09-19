"use client";
import useSWR from "swr";
import Link from "next/link";
import { BookOpen, CalendarDays, FileText, Megaphone } from "lucide-react";
import { get, authApi } from "@/lib/api/client";
import { PageHeader, StatCard, Card, DashboardSkeleton, ErrorState, Badge } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import { offeringContextCode } from "@/lib/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherDashboard() {
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const { data, error, isLoading, mutate } = useSWR("teacher-dash", () => get<Row>("/reports/teacher-dashboard").then((r) => r.data));
  if (isLoading) return <><PageHeader title="Dashboard" /><DashboardSkeleton stats={4} panels={2} /></>;
  if (error || !data) return <><PageHeader title="Dashboard" /><ErrorState message="Failed to load dashboard" onRetry={() => mutate()} /></>;
  const assignments = (data.assignments as Row[] | undefined) ?? [];
  const upcoming = assignments.flatMap((a) => ((a.courseOffering as Row)?.assessments as Row[] | undefined ?? []).map((x): Row => ({ ...x, course: str(((a.courseOffering as Row)?.course as Row)?.title), offeringId: str((a.courseOffering as Row)?.id) }))).slice(0, 5);
  const notices = assignments.flatMap((a) => ((a.courseOffering as Row)?.notices as Row[] | undefined ?? [])).slice(0, 5);

  return (
    <div>
      <PageHeader title={`Welcome, ${me?.name ?? "Teacher"}`} subtitle="Your classes, tasks and updates." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="My offerings" value={assignments.length} icon={<BookOpen size={20} />} tone="blue" />
        <StatCard label="Today's classes" value={Number(data.todayClasses ?? 0)} icon={<CalendarDays size={20} />} tone="green" />
        <StatCard label="Upcoming assessments" value={upcoming.length} icon={<FileText size={20} />} tone="amber" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">My course offerings</h2>
          {assignments.length === 0 ? <p className="text-sm text-slate-500">No active assignments.</p> : (
            <div className="space-y-2">
              {assignments.map((a) => (
                <Link key={str(a.id)} href={`/teacher/course-offerings/${(a.courseOffering as Row)?.id}`} className="block rounded-lg bg-slate-50 p-3 hover:bg-slate-100">
                  <p className="font-medium">{str(((a.courseOffering as Row)?.course as Row)?.title)}</p>
                  {offeringContextCode(a.courseOffering as Row) && (
                    <p className="mt-0.5 font-mono text-xs text-brand-700" title="Course offering context code">
                      {offeringContextCode(a.courseOffering as Row)}
                    </p>
                  )}
                  <div className="mt-1.5">
                    <CourseOfferingBadges offering={a.courseOffering as Row} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Upcoming assessments</h2>
            {upcoming.length === 0 ? <p className="text-sm text-slate-500">Nothing due soon.</p> : (
              <div className="space-y-2">
                {upcoming.map((u) => (
                  <div key={str(u.id)} className="flex items-center justify-between text-sm">
                    <span>{str(u.title)} <span className="text-xs text-slate-400">· {str(u.course)}</span></span>
                    <Badge tone="amber">{u.dueDate ? str(u.dueDate).slice(0, 10) : "No due date"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Megaphone size={16} /> Recent notices</h2>
            {notices.length === 0 ? <p className="text-sm text-slate-500">No notices yet.</p> : (
              <div className="space-y-2">
                {notices.map((n) => <p key={str(n.id)} className="text-sm text-slate-600">{str(n.title)} <span className="text-xs text-slate-400">· {str(n.publishedAt).slice(0, 10)}</span></p>)}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
