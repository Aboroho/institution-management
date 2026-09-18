"use client";

import Link from "next/link";
import useSWR from "swr";
import { get } from "@/lib/api/client";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import { PageHeader, Card, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, Badge } from "@/components/ui";
import { Megaphone, Paperclip } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");
const row = (value: unknown): Row => (typeof value === "object" && value !== null ? value as Row : {});

export default function StudentNotices() {
  const { data, error, isLoading, mutate } = useSWR("student-notices", () => get<Row[]>("/notices?limit=100").then((response) => response.data));
  const items = data ?? [];
  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Notices" }]} />
      <PageHeader title="Notices" subtitle="Announcements addressed to you through your courses or institution." />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load notices" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No notices" /> : (
        <div className="space-y-3">
          {items.map((notice) => {
            const offering = row(notice.courseOffering);
            const creator = row(notice.createdBy);
            const attachments = Number((notice._count as Row | undefined)?.attachments ?? 0);
            return (
              <Card key={str(notice.id)} className="p-4 transition hover:shadow-sm">
                <Link href={`/student/notices/${str(notice.id)}`} className="block">
                  <p className="flex items-center gap-2 font-semibold text-slate-900 hover:text-brand-700"><Megaphone size={17} className="text-brand-600" />{str(notice.title)}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{str(notice.content)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>By {str(creator.name) || "EMS"}</span>
                    <span>·</span>
                    <span>{notice.publishedAt ? new Date(str(notice.publishedAt)).toLocaleString() : "—"}</span>
                    {attachments > 0 && <Badge><Paperclip size={12} className="mr-1" />{attachments} attachment{attachments === 1 ? "" : "s"}</Badge>}
                  </div>
                  {Boolean(offering.id) && <div className="mt-2"><CourseOfferingBadges offering={offering} /></div>}
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
