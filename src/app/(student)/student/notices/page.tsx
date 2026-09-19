"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { get, qs, ApiError } from "@/lib/api/client";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import {
  Badge, Breadcrumbs, Card, CardListSkeleton, EmptyState, ErrorState, ExpandableText,
  InlineLoading, Input, Label, PageHeader, Pagination,
} from "@/components/ui";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Megaphone, Paperclip, Search } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");
const row = (value: unknown): Row => (typeof value === "object" && value !== null ? value as Row : {});

/**
 * Student notice list.
 *
 * Previously fetched 100 notices at once and clamped each body to three lines
 * with no way to read the rest in place. Now paginated and searchable, with an
 * inline expand for long messages; the details page still holds the full notice
 * and its attachments.
 */
export default function StudentNotices() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 350);
  const [page, setPage] = useState(1);

  const query = useMemo(() => qs({ page, limit: 20, search: search || undefined }), [page, search]);
  const { data, error, isLoading, isValidating, mutate } = useSWR(`student-notices${query}`, () => get<Row[]>(`/notices${query}`), {
    keepPreviousData: true,
  });
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Row | undefined)?.total ?? items.length);
  const initialLoading = isLoading && !data;
  const refreshing = isValidating && !initialLoading;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Student", href: "/student/dashboard" }, { label: "Notices" }]} />
      <PageHeader title="Notices" subtitle="Announcements addressed to you through your courses or institution." />

      <Card className="mb-4 p-4">
        <div className="max-w-md">
          <Label htmlFor="student-notice-search">Search notices</Label>
          <div className="relative">
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              id="student-notice-search"
              type="search"
              className="pl-9"
              value={searchInput}
              onChange={(event) => { setSearchInput(event.target.value); setPage(1); }}
              placeholder="Search title or message..."
            />
          </div>
        </div>
        {refreshing && <div className="mt-3"><InlineLoading label="Updating results…" /></div>}
      </Card>

      {initialLoading ? (
        <CardListSkeleton count={4} lines={3} label="Loading notices" />
      ) : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : "Failed to load notices"} onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={searchInput ? "No matching notices" : "No notices"}
          hint={searchInput ? "Try a different search term." : "Announcements from your courses will appear here."}
        />
      ) : (
        <>
          <div className={refreshing ? "space-y-3 opacity-70 transition-opacity" : "space-y-3"}>
            {items.map((notice) => {
              const offering = row(notice.courseOffering);
              const creator = row(notice.createdBy);
              const attachments = Number(row(notice._count).attachments ?? 0);
              return (
                <Card key={str(notice.id)} className="p-4 transition hover:shadow-sm">
                  <Link
                    href={`/student/notices/${str(notice.id)}`}
                    className="flex items-start gap-2 font-semibold text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <Megaphone size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" />
                    <span className="min-w-0 break-words">{str(notice.title)}</span>
                  </Link>
                  <ExpandableText className="mt-1.5" text={str(notice.content)} lines={3} />
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>By {str(creator.name) || "EMS"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{notice.publishedAt ? new Date(str(notice.publishedAt)).toLocaleDateString() : "—"}</span>
                    {attachments > 0 && (
                      <Badge><Paperclip size={11} aria-hidden="true" className="mr-1" />{attachments} attachment{attachments === 1 ? "" : "s"}</Badge>
                    )}
                  </div>
                  {Boolean(offering.id) && <div className="mt-2"><CourseOfferingBadges offering={offering} /></div>}
                </Card>
              );
            })}
          </div>
          <Pagination page={page} limit={20} total={total} onPage={setPage} busy={refreshing} />
        </>
      )}
    </div>
  );
}
