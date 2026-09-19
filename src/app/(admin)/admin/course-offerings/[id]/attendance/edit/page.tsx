"use client";
import { Suspense } from "react";
import { Breadcrumbs, PageHeader, CardListSkeleton, ErrorState, Card } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { CourseOfferingBanner } from "@/components/course-offering-context";
import { ShieldAlert } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admin attendance edit URL — intentionally read-only.
 *
 * Product decision 2026-09-15: admins cannot take or edit attendance. This
 * route is kept (instead of deleted) so old bookmarks land on an explanatory
 * notice rather than a 404, and the backend rejects admin saves with 403 as
 * defense in depth.
 */
export default function AdminEditAttendancePage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<CardListSkeleton count={3} lines={4} label="Loading attendance" />}>
      <Content id={params.id} />
    </Suspense>
  );
}

function Content({ id }: { id: string }) {
  const { data, error, isLoading } = useSWR(`off-${id}`, () =>
    get<Row>(`/course-offerings/${id}`).then((r) => r.data),
  );

  if (isLoading) return <CardListSkeleton count={3} lines={4} label="Loading attendance" />;
  if (error || !data) return <ErrorState message="Failed to load course offering" />;

  const course = data.course as Row | undefined;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Course Offerings", href: "/admin/course-offerings" },
          { label: str(course?.title), href: `/admin/course-offerings/${id}` },
          { label: "Attendance", href: `/admin/course-offerings/${id}/attendance?tab=report` },
          { label: "Edit" },
        ]}
      />
      <PageHeader
        title={`Edit Attendance — ${str(course?.title)}`}
        subtitle="This action is not available to admins."
      />
      <CourseOfferingBanner offering={data} eyebrow="Read-only context" />
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <ShieldAlert size={24} />
        </span>
        <p className="mt-3 font-semibold text-slate-800">Admins cannot edit attendance</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Attendance is recorded and corrected by the assigned teacher. If a correction is
          needed, the teacher submits a change request and you approve it from Attendance →
          Approvals.
        </p>
        <span className="mt-4 flex flex-wrap justify-center gap-2">
          <a
            href={`/admin/course-offerings/${id}/attendance?tab=report`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Back to Attendance Report
          </a>
          <a
            href="/admin/attendance?tab=approvals"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open Approvals
          </a>
        </span>
      </Card>
    </div>
  );
}
