"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, qs } from "@/lib/api/client";
import { PageHeader, Button, Card, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, Tabs, Badge } from "@/components/ui";
import { Bell } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function TeacherNotifications() {
  const [tab, setTab] = useState("unread");
  const query = qs({ limit: 50, unread: tab === "unread" ? "true" : undefined });
  const { data, error, isLoading, mutate } = useSWR(`t-notif${query}`, () => get<Row[]>(`/notifications${query}`));
  const items = (data?.data ?? []) as Row[];
  async function markRead(id: string) { await post(`/notifications/${id}/read`, {}); await mutate(); }
  async function markAll() { await post("/notifications/read-all", {}); await mutate(); }
  return (
    <div>
      <Breadcrumbs items={[{ label: "Teacher", href: "/teacher/dashboard" }, { label: "Notifications" }]} />
      <PageHeader title="Notifications" actions={<Button variant="outline" onClick={markAll}>Mark all read</Button>} />
      <Tabs tabs={[{ id: "unread", label: "Unread" }, { id: "all", label: "All" }]} active={tab} onChange={setTab} />
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No notifications" /> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={str(n.id)} className={`flex items-start gap-3 p-4 ${!n.isRead ? "border-l-4 border-l-brand-500" : ""}`}>
              <span className="rounded-full bg-slate-100 p-2 text-slate-500"><Bell size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{str(n.title)}</p><Badge tone="blue">{str(n.type)}</Badge></div>
                <p className="mt-1 text-sm text-slate-600">{str(n.message)}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(str(n.createdAt)).toLocaleString()}</p>
              </div>
              {!n.isRead && <Button variant="outline" onClick={() => markRead(str(n.id))}>Mark read</Button>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
