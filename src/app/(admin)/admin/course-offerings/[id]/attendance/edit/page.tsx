"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceTakeForm } from "@/components/attendance/attendance-take-form";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminEditAttendancePage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <Content id={params.id} />
    </Suspense>
  );
}

function Content({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

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
          { label: "Attendance Report", href: `/admin/course-offerings/${id}/attendance/report` },
          { label: `Edit ${date}` },
        ]}
      />
      <PageHeader
        title={`Edit Attendance — ${str(course?.title)}`}
        subtitle={`Section ${str(section?.name)} · Editing date ${date}.`}
      />
      <AttendanceTakeForm offeringId={id} offering={data} initialDate={date} lockDate />
    </div>
  );
}
