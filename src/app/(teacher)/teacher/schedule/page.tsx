"use client";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { PageHeader, Card, Table, CardListSkeleton, EmptyState, ErrorState, Breadcrumbs } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TeacherSchedule() {
  const { data, error, isLoading, mutate } = useSWR("t-schedule", () => get<Row[]>("/schedules").then((r) => r.data));
  const versions = data ?? [];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Teacher", href: "/teacher/dashboard" }, { label: "Schedule" }]} />
      <PageHeader title="My Schedule" subtitle="Weekly timetable for your current offerings." />
      {isLoading ? <CardListSkeleton count={2} lines={5} label="Loading schedule" /> : error ? <ErrorState message="Failed to load schedule" onRetry={() => mutate()} /> : versions.length === 0 ? <EmptyState title="No scheduled classes" /> : (
        <div className="space-y-3">
          {versions.map((v) => (
            <Card key={str(v.id)} className="p-4">
              <p className="font-semibold">{str(((v.courseOffering as Row)?.course as Row)?.title)}</p>
              <div className="mb-2 mt-1.5">
                <CourseOfferingBadges offering={v.courseOffering as Row} />
              </div>
              <Table headers={["Day", "Start", "End", "Room"]}>
                {((v.items as Row[]) ?? []).map((it, i) => <tr key={i}><td className="px-4 py-2">{DAYS[Number(it.weekday)]}</td><td className="px-4 py-2">{str(it.startTime)}</td><td className="px-4 py-2">{str(it.endTime)}</td><td className="px-4 py-2">{str(it.room || it.lab || "—")}</td></tr>)}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
