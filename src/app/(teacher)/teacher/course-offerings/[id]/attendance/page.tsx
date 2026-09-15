"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Breadcrumbs, PageHeader, LoadingSkeleton, ErrorState, Tabs } from "@/components/ui";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { AttendanceTakeForm } from "@/components/attendance/attendance-take-form";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";
import { CourseOfferingBanner } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

const TABS = [
  { id: "take", label: "Take Attendance" },
  { id: "report", label: "Attendance Report" },
];

export default function TeacherAttendancePage({ params }: { params: { id: string } }) {
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
  const base = `/teacher/course-offerings/${id}/attendance`;

  function switchTab(t: string) {
    setTab(t);
    router.replace(`${base}?tab=${t}`);
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "My Courses", href: "/teacher/course-offerings" },
          { label: str(course?.title), href: `/teacher/course-offerings/${id}` },
          { label: "Attendance" },
        ]}
      />
      <PageHeader
        title={`Attendance — ${str(course?.title)}`}
        subtitle={`Section ${str(section?.name)} · Take attendance for a date, or review past sessions, statuses and change history.`}
      />
      <CourseOfferingBanner
        offering={data}
        eyebrow={tab === "take" ? "Taking attendance for" : "Viewing attendance for"}
      />
      <Tabs tabs={TABS} active={tab} onChange={switchTab} />
      {tab === "take" ? (
        <AttendanceTakeForm offeringId={id} offering={data} />
      ) : (
        <AttendanceReportList
          offeringId={id}
          offering={data}
          offeringTitle={`${str(course?.title)} · ${str(section?.name)}`}
          editBasePath={`/teacher/course-offerings/${id}/attendance/edit`}
        />
      )}
    </div>
  );
}
