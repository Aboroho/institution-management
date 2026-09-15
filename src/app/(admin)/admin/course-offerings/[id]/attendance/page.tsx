"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState, Tabs } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceTakeForm } from "@/components/attendance/attendance-take-form";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

const TABS = [
  { id: "take", label: "Take Attendance" },
  { id: "report", label: "Attendance Report" },
];

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
  const initial = searchParams.get("tab") === "report" ? "report" : "take";
  const [tab, setTab] = useState(initial);

  const { data, error, isLoading } = useSWR(`off-${id}`, () =>
    get<Row>(`/course-offerings/${id}`).then((r) => r.data),
  );

  if (isLoading) return <LoadingSkeleton rows={4} />;
  if (error || !data) return <ErrorState message="Failed to load course offering" />;

  const course = data.course as Row | undefined;
  const section = data.section as Row | undefined;
  const base = `/admin/course-offerings/${id}/attendance`;

  function switchTab(t: string) {
    setTab(t);
    router.replace(`${base}?tab=${t}`);
  }

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
        subtitle={`Section ${str(section?.name)} · Record attendance for a date, or review past sessions, statuses and change history. Admin edits bypass teacher modification limits.`}
      />
      <Tabs tabs={TABS} active={tab} onChange={switchTab} />
      {tab === "take" ? (
        <AttendanceTakeForm
          offeringId={id}
          offering={data}
          reportHref={`/admin/course-offerings/${id}/attendance?tab=report`}
        />
      ) : (
        <AttendanceReportList
          offeringId={id}
          offeringTitle={`${str(course?.title)} · ${str(section?.name)}`}
          editBasePath={`/admin/course-offerings/${id}/attendance/edit`}
        />
      )}
    </div>
  );
}
