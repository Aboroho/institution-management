"use client";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, CardListSkeleton, EmptyState, ErrorState, Breadcrumbs, Badge } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";
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
      {isLoading ? <CardListSkeleton count={3} lines={3} label="Loading assigned courses" /> : error ? <ErrorState message="Failed to load offerings" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No assigned courses" hint="Ask your administrator for an assignment." /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((o) => (
            <Link key={str(o.id)} href={`/teacher/course-offerings/${o.id}`}>
              <Card className="p-5 transition hover:shadow-md">
                <p className="font-bold">{str((o.course as Row)?.title)}</p>
                {str(o.context) && (
                  <p className="mt-0.5 font-mono text-xs text-brand-700" title="Course offering context code">{str(o.context)}</p>
                )}
                <div className="mt-2">
                  <CourseOfferingBadges offering={o} />
                </div>
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
