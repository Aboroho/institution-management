"use client";
import { Suspense } from "react";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminAttendanceReportPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <Content id={params.id} />
    </Suspense>
  );
}

function Content({ id }: { id: string }) {
  const { data, error, isLoading } = useSWR(`off-${id}`, () =>
    get<Row>(`/course-offerings/${id}`).then((r) => r.data),
  );

  if (isLoading) return <LoadingSkeleton rows={4} />;
  if (error || !data) return <ErrorState message="Failed to load course offering" />;

  const course = data.course as Row | undefined;
  const section = data.section as Row | undefined;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Course Offerings", href: "/admin/course-offerings" },
          { label: str(course?.title), href: `/admin/course-offerings/${id}` },
          { label: "Attendance Report" },
        ]}
      />
      <PageHeader
        title={`Attendance Report — ${str(course?.title)}`}
        subtitle={`Section ${str(section?.name)} · Institution-wide view of attendance sessions.`}
        actions={
          <a
            href={`/admin/course-offerings/${id}/attendance/take`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Take Attendance
          </a>
        }
      />
      <AttendanceReportList
        offeringId={id}
        offeringTitle={`${str(course?.title)} · ${str(section?.name)}`}
        editBasePath={`/admin/course-offerings/${id}/attendance/edit`}
      />
    </div>
  );
}
