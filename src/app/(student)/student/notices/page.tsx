"use client";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { PageHeader, Card, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentNotices() {
  const { data, error, isLoading, mutate } = useSWR("st-notices", () => get<Row[]>("/notices?limit=100").then((r) => r.data));
  const items = data ?? [];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Notices" }]} />
      <PageHeader title="Notices" subtitle="Announcements for your courses." />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load notices" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No notices" /> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={str(n.id)} className="p-4">
              <p className="font-semibold">{str(n.title)}</p>
              <p className="mt-1 text-sm text-slate-600">{str(n.content)}</p>
              <p className="mt-1 text-xs text-slate-400">{str(((n.courseOffering as Row)?.course as Row)?.title)} · {str(((n.courseOffering as Row)?.section as Row)?.name)} · {str(n.publishedAt).slice(0, 10)} · by {str(((n.teacher as Row)?.user as Row)?.name)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
