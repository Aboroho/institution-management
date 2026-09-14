"use client";
import { Suspense } from "react";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceTakeForm } from "@/components/attendance/attendance-take-form";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherTakeAttendancePage({ params }: { params: { id: string } }) {
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
          { label: "My Courses", href: "/teacher/course-offerings" },
          { label: str(course?.title), href: `/teacher/course-offerings/${id}` },
          { label: "Take Attendance" },
        ]}
      />
      <PageHeader
        title={`Take Attendance — ${str(course?.title)}`}
        subtitle={`Section ${str(section?.name)} · Select a date and record attendance for each enrolled student.`}
        actions={
          <a
            href={`/teacher/course-offerings/${id}/attendance/report`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Attendance Report
          </a>
        }
      />
      <AttendanceTakeForm offeringId={id} offering={data} />
    </div>
  );
}
