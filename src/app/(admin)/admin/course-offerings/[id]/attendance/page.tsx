"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admin attendance for one course offering — REPORT ONLY.
 *
 * Admins must never see "Take Attendance" and must never edit attendance.
 * Legacy `?tab=take` URLs are normalized to `?tab=report` so old bookmarks
 * land on the read-only report instead of a (removed) take form.
 */
export default function AdminAttendancePage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <Content id={params.id} />
    </Suspense>
  );
}

function Content({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("tab") !== "report") {
      router.replace(`/admin/course-offerings/${id}/attendance?tab=report`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
        subtitle={`Section ${str(section?.name)} · Historical sessions, student statuses and change history. Read-only: admins approve change requests instead of editing attendance.`}
      />
      <AttendanceReportList
        offeringId={id}
        offeringTitle={`${str(course?.title)} · ${str(section?.name)}`}
        showEdit={false}
      />
    </div>
  );
}
