"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { del, get, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { NoticeComposer, type NoticeComposerInitial } from "@/components/notices/notice-composer";
import { CourseOfferingCell } from "@/components/course-offering-context";
import { PageHeader, Button, Card, LoadingSkeleton, EmptyState, ErrorState, Input, Pagination, Breadcrumbs, Badge, Label, SearchableSelect } from "@/components/ui";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");
const row = (value: unknown): Row => (typeof value === "object" && value !== null ? value as Row : {});

function composerInitial(notice: Row): NoticeComposerInitial {
  return {
    id: str(notice.id),
    version: Number(notice.version ?? 1),
    title: str(notice.title),
    content: str(notice.content),
    expiresAt: notice.expiresAt ? str(notice.expiresAt) : null,
    targets: (Array.isArray(notice.targets) ? notice.targets : []).map((target) => {
      const value = row(target);
      return { targetType: str(value.targetType) as "EVERYONE" | "ADMINS" | "COURSE_OFFERING" | "TEACHER" | "STUDENT", targetId: str(value.targetId) };
    }),
    attachments: (Array.isArray(notice.attachments) ? notice.attachments : []).flatMap((attachment) => {
      const value = row(attachment);
      const file = row(value.file);
      return value.id && file.id ? [{ id: str(value.id), file: { id: str(file.id), originalName: str(file.originalName), mimeType: str(file.mimeType), size: Number(file.size ?? 0) } }] : [];
    }),
  };
}

export default function AdminNoticesPage() {
  const [search, setSearch] = useState("");
  const [courseOfferingId, setCourseOfferingId] = useState("");
  const [page, setPage] = useState(1);
  const offerings = useOfferings("&isActive=true");
  const [composer, setComposer] = useState<null | { mode: "create" } | { mode: "edit"; notice: Row }>(null);
  const [actionError, setActionError] = useState("");
  const query = qs({ page, limit: 25, search: search || undefined, courseOfferingId: courseOfferingId || undefined });
  const { data, error, isLoading, mutate } = useSWR(`admin-notices${query}`, () => get<Row[]>(`/notices${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Row | undefined)?.total ?? items.length);

  async function removeNotice(notice: Row) {
    if (!window.confirm("Delete this notice? It will no longer be available to recipients.")) return;
    setActionError("");
    try {
      await del(`/notices/${str(notice.id)}?version=${encodeURIComponent(String(notice.version ?? 1))}`);
      await mutate();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to delete the notice.");
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Notices" }]} />
      <PageHeader
        title="Notices"
        subtitle="Send institution-wide or targeted announcements with private attachments."
        actions={<Button onClick={() => { setActionError(""); setComposer({ mode: "create" }); }}><Plus size={16} /> New notice</Button>}
      />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="notice-search" className="mb-1 block text-sm font-medium text-slate-700">Search notices</label>
            <Input id="notice-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search title or message..." />
          </div>
          <div className="min-w-[280px] flex-1">
            <Label>Course offering</Label>
            <SearchableSelect options={offerings} value={courseOfferingId} onChange={(value) => { setCourseOfferingId(value); setPage(1); }} clearLabel="All offerings" />
          </div>
          <Button variant="outline" onClick={() => { setSearch(""); setCourseOfferingId(""); setPage(1); }}>Clear</Button>
        </div>
      </Card>
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load notices" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No notices" hint={search ? "Try a different search." : "Create the first targeted notice."} action={<Button onClick={() => setComposer({ mode: "create" })}><Plus size={16} /> New notice</Button>} />
      ) : (
        <>
          <div className="space-y-3">
            {items.map((notice) => {
              const creator = row(notice.createdBy);
              const offering = row(notice.courseOffering);
              return (
                <Card key={str(notice.id)} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/notices/${str(notice.id)}`} className="flex items-center gap-2 text-lg font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                        <Megaphone size={18} className="shrink-0 text-brand-600" /> {str(notice.title)}
                      </Link>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{str(notice.content)}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>By {str(creator.name) || "Unknown"}</span>
                        <span>·</span>
                        <span>{notice.publishedAt ? new Date(str(notice.publishedAt)).toLocaleString() : "—"}</span>
                        <Badge tone="blue">{str((notice._count as Row | undefined)?.recipients ?? 0)} recipients</Badge>
                        <Badge>{str((notice._count as Row | undefined)?.attachments ?? 0)} files</Badge>
                      </div>
                      {Boolean(offering.id) && <div className="mt-2 text-sm"><CourseOfferingCell offering={offering} /></div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {notice.canEdit === true && <Button variant="ghost" size="sm" onClick={() => setComposer({ mode: "edit", notice })}><Pencil size={15} /> Edit</Button>}
                      {notice.canDelete === true && <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => removeNotice(notice)}><Trash2 size={15} /> Delete</Button>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <NoticeComposer
        open={composer !== null}
        role="ADMIN"
        initial={composer?.mode === "edit" ? composerInitial(composer.notice) : null}
        onClose={() => setComposer(null)}
        onSaved={async () => { await mutate(); }}
      />
    </div>
  );
}
