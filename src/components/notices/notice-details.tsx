"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ApiError, del, get, post } from "@/lib/api/client";
import { NoticeComposer, type NoticeComposerInitial, type NoticeTargetKind } from "@/components/notices/notice-composer";
import { CourseOfferingBadges, CourseOfferingCell } from "@/components/course-offering-context";
import { Badge, Breadcrumbs, Button, Card, EmptyState, ErrorState, LoadingSkeleton, PageHeader, Spinner } from "@/components/ui";
import { ArrowLeft, Download, Megaphone, Paperclip, Pencil, Trash2 } from "lucide-react";

export type NoticeDetailsRole = "ADMIN" | "TEACHER" | "STUDENT";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");
const row = (value: unknown): Row => (typeof value === "object" && value !== null ? value as Row : {});

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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
      return value.id && file.id ? [{ id: str(value.id), file: { id: str(file.id), originalName: str(file.originalName), mimeType: str(file.mimeType), size: Number(file.size ?? 0) } }] : [];
    }),
  };
}

function targetLabel(target: Row): string {
  const type = str(target.targetType);
  if (type === "EVERYONE") return "Everyone in the system";
  if (type === "ADMINS") return "All active admins";
  if (type === "COURSE_OFFERING") return "Selected course offering";
  if (type === "TEACHER") return "Selected teacher";
  if (type === "STUDENT") return "Selected student";
  return "Recipient target";
}

export function NoticeDetails({ role, noticeId }: { role: NoticeDetailsRole; noticeId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate: globalMutate } = useSWRConfig();
  const [composerOpen, setComposerOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [readError, setReadError] = useState("");
  const [downloadId, setDownloadId] = useState("");
  const markedNotification = useRef<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<Row>(`notice-detail-${noticeId}`, () => get<Row>(`/notices/${noticeId}`).then((response) => response.data));
  const notificationId = searchParams.get("notification");

  useEffect(() => {
    if (!data || !notificationId || markedNotification.current === notificationId) return;
    setReadError("");
    void post(`/notifications/${notificationId}/read`, {})
      .then(() => {
        markedNotification.current = notificationId;
        return globalMutate("notif-count");
      })
      .catch((caught) => setReadError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen."));
  }, [data, globalMutate, notificationId]);

  async function retryRead() {
    if (!notificationId) return;
    setReadError("");
    try {
      await post(`/notifications/${notificationId}/read`, {});
      markedNotification.current = notificationId;
      await globalMutate("notif-count");
    } catch (caught) {
      setReadError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen.");
    }
  }

  async function downloadAttachment(attachmentId: string) {
    setActionError("");
    setDownloadId(attachmentId);
    try {
      const response = await get<{ url: string }>(`/notices/${noticeId}/attachments/${attachmentId}/download`);
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to download attachment.");
    } finally {
      setDownloadId("");
    }
  }

  async function deleteCurrentNotice() {
    if (!data || !window.confirm("Delete this notice? Recipients will no longer be able to open it.")) return;
    setActionError("");
    try {
      await del(`/notices/${noticeId}?version=${encodeURIComponent(String(data.version ?? 1))}`);
      router.push(`/${role.toLowerCase()}/notices`);
      router.refresh();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to delete the notice.");
    }
  }

  if (isLoading) return <><PageHeader title="Notice" /><LoadingSkeleton rows={4} /></>;
  if (error || !data) return <><PageHeader title="Notice" /><ErrorState message="This notice is missing, deleted, or not available to your account." onRetry={() => mutate()} /></>;

  const creator = row(data.createdBy);
  const offering = row(data.courseOffering);
  const targets = (Array.isArray(data.targets) ? data.targets : []) as unknown[];
  const targetDetails = (Array.isArray(data.targetDetails) ? data.targetDetails : []) as unknown[];
  const attachments = (Array.isArray(data.attachments) ? data.attachments : []) as unknown[];
  const recipients = (Array.isArray(data.recipients) ? data.recipients : []) as unknown[];
  const canManage = data.canEdit === true || data.canDelete === true;

  return (
    <div>
      <Breadcrumbs items={[{ label: role === "ADMIN" ? "Admin" : role === "TEACHER" ? "Teacher" : "Student", href: `/${role.toLowerCase()}/dashboard` }, { label: "Notices", href: `/${role.toLowerCase()}/notices` }, { label: str(data.title) }]} />
      <PageHeader
        title={str(data.title)}
        subtitle={`By ${str(creator.name) || "EMS"} · Published ${data.publishedAt ? new Date(str(data.publishedAt)).toLocaleString() : "—"}${data.updatedAt && data.updatedAt !== data.createdAt ? ` · Updated ${new Date(str(data.updatedAt)).toLocaleString()}` : ""}`}
        actions={canManage ? <><Button variant="outline" onClick={() => setComposerOpen(true)}><Pencil size={15} /> Edit</Button><Button variant="danger" onClick={deleteCurrentNotice}><Trash2 size={15} /> Delete</Button></> : <Link href={`/${role.toLowerCase()}/notices`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft size={15} /> Back</Link>}
      />
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {readError && <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{readError}<Button size="sm" variant="outline" onClick={retryRead}>Retry</Button></p>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-700"><Megaphone size={17} /> Notice message</div>
            <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{str(data.content)}</div>
            {Boolean(data.expiresAt) && <p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">Expires {new Date(str(data.expiresAt)).toLocaleDateString()}</p>}
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Paperclip size={17} /> Attachments</h2>
            {attachments.length === 0 ? <p className="mt-3 text-sm text-slate-500">No files attached.</p> : (
              <div className="mt-3 space-y-2">
                {attachments.map((attachment) => {
                  const value = row(attachment);
                  const file = row(value.file);
                  return (
                    <div key={str(value.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3">
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{str(file.originalName)}</p><p className="text-xs text-slate-500">{str(file.mimeType)} · {bytes(Number(file.size ?? 0))}</p></div>
                      <Button size="sm" variant="outline" onClick={() => downloadAttachment(str(value.id))} disabled={downloadId === str(value.id)}>{downloadId === str(value.id) ? <Spinner /> : <Download size={14} />} Open</Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          {Boolean(offering.id) && <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-slate-900">Course context</h2><CourseOfferingCell offering={offering} /></Card>}
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Audience</h2>
            <div className="mt-3 flex flex-wrap gap-2">{targets.length === 0 ? <p className="text-sm text-slate-500">Audience details unavailable.</p> : targets.map((target) => {
              const value = row(target);
              const detail = targetDetails.find((candidate) => {
                const item = row(candidate);
                return item.targetType === value.targetType && item.targetId === value.targetId;
              });
              return <Badge key={`${str(value.targetType)}:${str(value.targetId)}`} tone="blue">{detail ? str(row(detail).label) : targetLabel(value)}</Badge>;
            })}</div>
            {targets.some((target) => str(row(target).targetType) === "COURSE_OFFERING") && Boolean(offering.id) && <div className="mt-3"><CourseOfferingBadges offering={offering} /></div>}
          </Card>
          {canManage && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Delivery and seen status</h2>
              {recipients.length === 0 ? <p className="mt-3 text-sm text-slate-500">No recipient records.</p> : (
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                  {recipients.map((recipient) => {
                    const value = row(recipient);
                    const user = row(value.user);
                    const notification = row(value.notification);
                    const isRead = value.notification && value.notification !== null && notification.isRead === true;
                    return <div key={str(value.id)} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs"><span className="min-w-0 truncate">{str(user.name)}<span className="block truncate text-slate-400">{str(user.email)}</span></span><Badge tone={isRead ? "green" : "amber"}>{isRead ? "Seen" : "Unread"}</Badge></div>;
                  })}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      <NoticeComposer open={composerOpen} role={role === "ADMIN" ? "ADMIN" : "TEACHER"} initial={composerInitial(data)} onClose={() => setComposerOpen(false)} onSaved={async () => { await mutate(); }} />
    </div>
  );
}

export function NoticeDetailsFromRoute({ role }: { role: NoticeDetailsRole }) {
  const params = useParams<{ id: string }>();
  return <NoticeDetails role={role} noticeId={params.id} />;
}
