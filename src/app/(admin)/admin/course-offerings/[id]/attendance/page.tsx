"use client";
import { Suspense } from "react";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState, Card } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";
import { CourseOfferingBanner } from "@/components/course-offering-context";
import { Eye } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admin per-offering attendance — READ-ONLY.
 *
 * Product decision 2026-09-15 (overrides README §10 "Admin: may edit
 * indefinitely"): admins inspect attendance entries and history, and approve
 * teacher change requests from /admin/attendance. They cannot take or edit
 * attendance, so this page has no Take tab and the report renders without the
 * Edit action (`showEdit={false}`). Legacy `?tab=take` links land here and
 * show the same read-only report.
 */
export default function AdminAttendancePage({ params }: { params: { id: string } }) {
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

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Course Offerings", href: "/admin/course-offerings" },
          { label: str(course?.title), href: `/admin/course-offerings/${id}` },
          { label: "Attendance" },
        ]}
      />
      <PageHeader
        title={`Attendance — ${str(course?.title)}`}
        subtitle="Read-only report: per-session summaries, student statuses and full change history. Corrections arrive as teacher change requests in Attendance → Approvals."
      />
      <CourseOfferingBanner offering={data} eyebrow="Viewing attendance for (read-only)" />
      <Card className="mb-4 border-blue-100 bg-blue-50/60 p-3">
        <p className="flex items-center gap-2 text-sm text-blue-900">
          <Eye size={16} className="shrink-0" />
          You are viewing as an admin. Attendance data cannot be changed here — use “Student Status” to see every entry and “History” for the immutable change log.
        </p>
      </Card>
      <AttendanceReportList
        offeringId={id}
        offering={data}
        editBasePath={`/admin/course-offerings/${id}/attendance/edit`}
        showEdit={false}
      />
    </div>
  );
}
