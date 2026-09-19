"use client";

/**
 * Staff notice list (admin + teacher).
 *
 * Previously two near-identical pages. They differed only in the portal label,
 * the composer role and one empty-state hint, so both now render this component
 * — one place to fix search feedback, delete confirmation and long content.
 *
 * Long notices are previewed and expanded in place; the full body always remains
 * reachable on the details page, so nothing is truncated without a way back.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { del, get, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { NoticeComposer, type NoticeComposerInitial, type NoticeTargetKind } from "@/components/notices/notice-composer";
import { CourseOfferingCell } from "@/components/course-offering-context";
import {
  Badge, Breadcrumbs, Button, Card, CardListSkeleton, ConfirmDialog, EmptyState, ErrorState,
  ExpandableText, IconButton, InlineLoading, Input, Label, PageHeader, Pagination,
  SearchableSelect, StatusMessage,
} from "@/components/ui";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Megaphone, Paperclip, Pencil, Plus, Search, Trash2 } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");
const row = (value: unknown): Row => (typeof value === "object" && value !== null ? value as Row : {});

export type NoticeListRole = "ADMIN" | "TEACHER";

function composerInitial(notice: Row): NoticeComposerInitial {
  return {
    id: str(notice.id),
    version: Number(notice.version ?? 1),
    title: str(notice.title),
    content: str(notice.content),
    expiresAt: notice.expiresAt ? str(notice.expiresAt) : null,
    targets: (Array.isArray(notice.targets) ? notice.targets : []).map((target) => {
      const value = row(target);
      return { targetType: str(value.targetType) as NoticeTargetKind, targetId: str(value.targetId) };
    }),
    attachments: (Array.isArray(notice.attachments) ? notice.attachments : []).flatMap((attachment) => {
      const value = row(attachment);
      const file = row(value.file);
      return value.id && file.id
        ? [{ id: str(value.id), file: { id: str(file.id), originalName: str(file.originalName), mimeType: str(file.mimeType), size: Number(file.size ?? 0) } }]
        : [];
    }),
  };
}

export function NoticeList({ role }: { role: NoticeListRole }) {
  const portal = role.toLowerCase();
  const portalLabel = role === "ADMIN" ? "Admin" : "Teacher";
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 350);
  const [courseOfferingId, setCourseOfferingId] = useState("");
  const [page, setPage] = useState(1);
  const offerings = useOfferings("&isActive=true");
  const [composer, setComposer] = useState<null | { mode: "create" } | { mode: "edit"; notice: Row }>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [banner, setBanner] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const firstLoad = useRef(true);

  const query = useMemo(
    () => qs({ page, limit: 25, search: search || undefined, courseOfferingId: courseOfferingId || undefined }),
    [page, search, courseOfferingId],
  );
  const { data, error, isLoading, isValidating, mutate } = useSWR(`${portal}-notices${query}`, () => get<Row[]>(`/notices${query}`), {
    keepPreviousData: true,
  });
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Row | undefined)?.total ?? items.length);
  // Distinguish "nothing on screen yet" from "refreshing what is on screen".
  const initialLoading = isLoading && !data;
  if (data) firstLoad.current = false;
  const refreshing = isValidating && !initialLoading;
  const filtersActive = Boolean(searchInput || courseOfferingId);

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await del(`/notices/${str(pendingDelete.id)}?version=${encodeURIComponent(String(pendingDelete.version ?? 1))}`);
      setPendingDelete(null);
      setBanner({ tone: "success", message: "Notice deleted." });
      await mutate();
    } catch (caught) {
      setDeleteError(caught instanceof ApiError ? caught.message : "Unable to delete the notice.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: portalLabel, href: `/${portal}/dashboard` }, { label: "Notices" }]} />
      <PageHeader
        title="Notices"
        subtitle={role === "ADMIN"
          ? "Institution-wide or targeted announcements with private attachments."
          : "Announcements for admins, your assigned offerings, or permitted students."}
        actions={<Button onClick={() => { setBanner(null); setComposer({ mode: "create" }); }}><Plus size={16} aria-hidden="true" /> New notice</Button>}
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label htmlFor={`${portal}-notice-search`}>Search notices</Label>
            <div className="relative">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                id={`${portal}-notice-search`}
                type="search"
                className="pl-9"
                value={searchInput}
                onChange={(event) => { setSearchInput(event.target.value); setPage(1); }}
                placeholder="Search title or message..."
              />
            </div>
          </div>
          <div className="min-w-[260px] flex-1">
            <Label>Course offering</Label>
            <SearchableSelect
              options={offerings}
              value={courseOfferingId}
              onChange={(value) => { setCourseOfferingId(value); setPage(1); }}
              clearLabel={role === "ADMIN" ? "All offerings" : "All assigned offerings"}
              ariaLabel="Course offering filter"
            />
          </div>
          <Button variant="outline" disabled={!filtersActive} onClick={() => { setSearchInput(""); setCourseOfferingId(""); setPage(1); }}>Clear</Button>
        </div>
        {refreshing && <div className="mt-3"><InlineLoading label="Updating results…" /></div>}
      </Card>

      {banner && <StatusMessage tone={banner.tone} onDismiss={() => setBanner(null)}>{banner.message}</StatusMessage>}

      {initialLoading ? (
        <CardListSkeleton count={4} lines={3} label="Loading notices" />
      ) : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : "Failed to load notices"} onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filtersActive ? "No matching notices" : "No notices yet"}
          hint={filtersActive ? "Try a different search or clear the filters." : "Publish an announcement to one of your permitted audiences."}
          action={filtersActive
            ? <Button variant="outline" onClick={() => { setSearchInput(""); setCourseOfferingId(""); setPage(1); }}>Clear filters</Button>
            : <Button onClick={() => setComposer({ mode: "create" })}><Plus size={16} aria-hidden="true" /> New notice</Button>}
        />
      ) : (
        <>
          <div className={refreshing ? "space-y-3 opacity-70 transition-opacity" : "space-y-3"}>
            {items.map((notice) => {
              const creator = row(notice.createdBy);
              const offering = row(notice.courseOffering);
              const counts = row(notice._count);
              const attachments = Number(counts.attachments ?? 0);
              return (
                <Card key={str(notice.id)} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${portal}/notices/${str(notice.id)}`}
                        className="flex items-start gap-2 text-base font-semibold text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <Megaphone size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" />
                        <span className="min-w-0 break-words">{str(notice.title)}</span>
                      </Link>
                      <ExpandableText className="mt-1.5" text={str(notice.content)} lines={2} />
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span>{role === "TEACHER" && notice.canEdit === true ? "Created by you" : `By ${str(creator.name) || "EMS"}`}</span>
                        <span aria-hidden="true">·</span>
                        <span>{notice.publishedAt ? new Date(str(notice.publishedAt)).toLocaleDateString() : "—"}</span>
                        <Badge tone="blue">{str(counts.recipients ?? 0)} recipients</Badge>
                        {attachments > 0 && <Badge><Paperclip size={11} aria-hidden="true" className="mr-1" />{attachments}</Badge>}
                      </div>
                      {Boolean(offering.id) && <div className="mt-2 text-sm"><CourseOfferingCell offering={offering} /></div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {notice.canEdit === true && (
                        <IconButton
                          label="Edit notice"
                          tooltip="Edit the title, message, audience or attachments"
                          icon={<Pencil size={15} aria-hidden="true" />}
                          onClick={() => { setBanner(null); setComposer({ mode: "edit", notice }); }}
                        />
                      )}
                      {notice.canDelete === true && (
                        <IconButton
                          label="Delete notice"
                          tooltip="Permanently removes it for every recipient"
                          icon={<Trash2 size={15} aria-hidden="true" />}
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => { setBanner(null); setDeleteError(""); setPendingDelete(notice); }}
                        />
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={page} limit={25} total={total} onPage={setPage} busy={refreshing} />
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this notice?"
        message={<>Recipients will no longer be able to open <span className="font-medium text-slate-800">{str(pendingDelete?.title)}</span>. This cannot be undone.</>}
        confirmLabel="Delete notice"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => { if (!deleting) { setPendingDelete(null); setDeleteError(""); } }}
      />

      <NoticeComposer
        open={composer !== null}
        role={role}
        initial={composer?.mode === "edit" ? composerInitial(composer.notice) : null}
        onClose={() => setComposer(null)}
        onSaved={async () => { setBanner({ tone: "success", message: composer?.mode === "edit" ? "Notice updated." : "Notice published." }); await mutate(); }}
      />
    </div>
  );
}
