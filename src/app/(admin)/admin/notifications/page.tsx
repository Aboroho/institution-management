"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { get, post, qs } from "@/lib/api/client";
import { PageHeader, Button, Card, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";
import { Bell } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState("unread");
  const [page, setPage] = useState(1);
  const query = qs({ page, limit: 25, unread: tab === "unread" ? "true" : undefined });
  const { data, error, isLoading, mutate } = useSWR(`notif${query}`, () => get<Row[]>(`/notifications${query}`));
  const items = (data?.data ?? []) as Row[];

  function approvalHref(notification: Row) {
    if (str(notification.type) !== "PENDING_APPROVAL") return null;
    if (str(notification.resourceType) === "AttendanceChangeRequest") return "/admin/attendance/approvals";
    if (str(notification.resourceType) === "AssessmentMarkChangeRequest") return "/admin/marks/approvals";
    return null;
  }

  async function markRead(id: string) { await post(`/notifications/${id}/read`, {}); await mutate(); }
  async function markAll() { await post("/notifications/read-all", {}); await mutate(); }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Notifications" }]} />
      <PageHeader title="Notifications" subtitle="In-app, email and SMS delivery tracking. No push notifications." actions={<Button variant="outline" onClick={markAll}>Mark all read</Button>} />
      <Tabs tabs={[{ id: "unread", label: "Unread" }, { id: "all", label: "All" }]} active={tab} onChange={(t) => { setTab(t); setPage(1); }} />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load notifications" onRetry={() => mutate()} /> : items.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const href = approvalHref(n);
            return (
            <Card key={str(n.id)} className={`flex items-start gap-3 p-4 ${!n.isRead ? "border-l-4 border-l-brand-500" : ""}`}>
              <span className="rounded-full bg-slate-100 p-2 text-slate-500"><Bell size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {href ? <Link href={href} className="font-semibold text-brand-700 hover:underline">{str(n.title)}</Link> : <p className="font-semibold">{str(n.title)}</p>}
                  <Badge tone="blue">{str(n.type)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">{str(n.message)}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(str(n.createdAt)).toLocaleString()} · Deliveries: {((n.deliveries as Row[]) ?? []).map((d) => `${str(d.channel)}:${str(d.status)}`).join(", ") || "—"}</p>
              </div>
              {!n.isRead && <Button variant="outline" onClick={() => markRead(str(n.id))}>Mark read</Button>}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
