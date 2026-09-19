"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { get } from "@/lib/api/client";
import { PageHeader, Card, CardListSkeleton, EmptyState, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentAssessments() {
  const [tab, setTab] = useState("upcoming");
  const { data, error, isLoading, mutate } = useSWR("st-assess", () => get<Row[]>("/assessments").then((r) => r.data));
  const all = data ?? [];
  const now = new Date();
  const withMeta = all.map((a) => {
    const submitted = ((a.submissions as Row[] | undefined) ?? []).length > 0;
    const mark = ((a.marks as Row[] | undefined) ?? [])[0];
    const pastDue = a.dueDate ? new Date(str(a.dueDate)) < now : false;
    return { a, submitted, mark, pastDue };
  });
  const filtered = withMeta.filter(({ submitted, mark, pastDue }) => {
    if (tab === "upcoming") return !pastDue && !submitted;
    if (tab === "submitted") return submitted && !mark;
    if (tab === "pastdue") return pastDue && !submitted;
    if (tab === "graded") return !!mark;
    return true;
  });

  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Assessments" }]} />
      <PageHeader title="My Assessments" />
      <Tabs tabs={[{ id: "upcoming", label: "Upcoming" }, { id: "submitted", label: "Submitted" }, { id: "pastdue", label: "Past due" }, { id: "graded", label: "Graded" }, { id: "all", label: "All" }]} active={tab} onChange={setTab} />
      {isLoading ? <CardListSkeleton count={3} lines={4} label="Loading assessments" /> : error ? <ErrorState message="Failed to load assessments" onRetry={() => mutate()} /> : filtered.length === 0 ? <EmptyState title="Nothing here" /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map(({ a, submitted, mark }) => (
            <Link key={str(a.id)} href={`/student/assessments/${a.id}`}>
              <Card className="p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{str(a.title)}</p>
                  {mark ? <Badge tone="green">{str(mark.marksObtained)}/{str(a.totalMarks)}</Badge> : submitted ? <Badge tone="blue">Submitted</Badge> : <Badge tone="amber">Pending</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{str(((a.courseOffering as Row)?.course as Row)?.title)} · {str(a.type)}</p>
                <p className="mt-1 text-xs text-slate-400">Due: {a.dueDate ? new Date(str(a.dueDate)).toLocaleString() : "No due date"} · Total: {str(a.totalMarks)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
