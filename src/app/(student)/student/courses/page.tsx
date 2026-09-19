"use client";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { PageHeader, Card, CardListSkeleton, ErrorState, Breadcrumbs, EmptyState } from "@/components/ui";
import { offeringContextCode } from "@/lib/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentCourses() {
  const { data, error, isLoading, mutate } = useSWR("st-grades", () => get<Row[] | null>("/auth/me").then(() => null).catch(() => null));
  const { data: me } = useSWR("me", () => import("@/lib/api/client").then((m) => m.authApi.me().then((r) => r.data)));
  const studentId = (me?.student as { id: string } | undefined)?.id;
  const { data: grades, error: gErr, isLoading: gLoad } = useSWR(studentId ? `st-marks-${studentId}` : null, () => get<Row[]>(`/students/${studentId}/marks`).then((r) => r.data));
  void data; void error; void isLoading; void mutate;
  const items = grades ?? [];

  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "My Courses" }]} />
      <PageHeader title="My Courses" subtitle="Courses from your current enrollment." />
      {gLoad ? <CardListSkeleton count={3} lines={3} label="Loading courses" /> : gErr ? <ErrorState message="Failed to load courses" /> : items.length === 0 ? <EmptyState title="No courses" hint="You have no active enrollment." /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((g) => (
            <Card key={str((g.offering as Row)?.id)} className="p-5">
              <p className="font-bold">{str(((g.offering as Row)?.course as Row)?.title)}</p>
              <p className="text-sm text-slate-500">Section {str(((g.offering as Row)?.section as Row)?.name)}</p>
              {offeringContextCode(g.offering as Row) && (
                <p className="mt-1 font-mono text-xs text-brand-700" title="Course offering context code">{offeringContextCode(g.offering as Row)}</p>
              )}
              <p className="mt-2 text-sm">{((g.assessments as Row[]) ?? []).length} assessments · Final: <strong>{str((g.final as Row)?.percentage)}% ({str((g.final as Row)?.grade)})</strong></p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
