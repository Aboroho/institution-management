"use client";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, Badge } from "@/components/ui";
import { Users, CalendarDays } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherOfferings() {
  const { data, error, isLoading, mutate } = useSWR("my-offerings", () => get<Row[]>("/course-offerings?limit=100").then((r) => r.data));
  const items = data ?? [];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Teacher", href: "/teacher/dashboard" }, { label: "My Courses" }]} />
      <PageHeader title="My Course Offerings" subtitle="Only courses you are actively assigned to." />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load offerings" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No assigned courses" hint="Ask your administrator for an assignment." /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((o) => (
            <Link key={str(o.id)} href={`/teacher/course-offerings/${o.id}`}>
              <Card className="p-5 transition hover:shadow-md">
                <p className="font-bold">{str((o.course as Row)?.title)}</p>
                <p className="text-sm text-slate-500">{str((o.course as Row)?.code)} · Section {str((o.section as Row)?.name)}</p>
                <p className="mt-1 text-xs text-slate-400">{str((o.academicYear as Row)?.name)} · {str((o.trade as Row)?.name)} · {str((o.semester as Row)?.name)} · {str((o.shift as Row)?.name)}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Users size={14} /> {str((o._count as Row)?.sessions ?? 0)} sessions</span>
                  <span className="flex items-center gap-1"><CalendarDays size={14} /> {str((o._count as Row)?.assessments ?? 0)} assessments</span>
                  {o.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
