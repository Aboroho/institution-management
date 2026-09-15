"use client";
import { Suspense } from "react";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState, Card, Button } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import Link from "next/link";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admins must never edit attendance directly. The edit route is kept so old
 * links explain the rule and guide back to the read-only report (the API
 * also rejects admin writes with 403 — this page never calls it).
 */
export default function AdminEditAttendancePage({ params }: { params: { id: string } }) {
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
          { label: "Attendance Report", href: `/admin/course-offerings/${id}/attendance?tab=report` },
          { label: "Edit (unavailable)" },
        ]}
      />
      <PageHeader
        title={`Attendance — ${str(course?.title)}`}
        subtitle={`Section ${str(section?.name)} · Direct editing is unavailable for admins.`}
      />
      <Card className="p-6 text-center">
        <p className="text-sm font-medium text-slate-700">
          Admins cannot edit attendance directly.
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Teachers take and edit attendance. When a teacher&apos;s edit quota is
          reached, they submit a change request for admin approval.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={`/admin/course-offerings/${id}/attendance?tab=report`}>
            <Button variant="outline">Back to Attendance Report</Button>
          </Link>
          <Link href="/admin/attendance?tab=approvals">
            <Button>Review change requests</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
