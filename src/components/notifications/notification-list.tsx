"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { notificationHref, type NotificationViewerRole } from "@/lib/notifications/links";
import { Badge, Breadcrumbs, Button, Card, EmptyState, ErrorState, PageHeader, Tabs } from "@/components/ui";
import { Bell } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");

export function NotificationList({ role }: { role: NotificationViewerRole }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [tab, setTab] = useState("unread");
  const [actionError, setActionError] = useState("");
  const query = qs({ limit: 50, unread: tab === "unread" ? "true" : undefined });
  const { data, error, isLoading, mutate } = useSWR(`notifications-${role}${query}`, () => get<Row[]>(`/notifications${query}`));
  const items = (data?.data ?? []) as Row[];

  async function markRead(id: string) {
    await post(`/notifications/${id}/read`, {});
    await Promise.all([mutate(), globalMutate("notif-count")]);
  }

  async function markReadAction(id: string) {
    setActionError("");
    try {
      await markRead(id);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen.");
    }
  }

  async function openNotification(notification: Row, href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (notification.isRead === true) return;
    event.preventDefault();
    try {
      await markRead(str(notification.id));
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen.");
    } finally {
      router.push(href);
    }
  }

  async function markAll() {
    setActionError("");
    try {
      await post("/notifications/read-all", {});
      await Promise.all([mutate(), globalMutate("notif-count")]);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to mark notifications as seen.");
    }
  }

  const portalLabel = role === "ADMIN" ? "Admin" : role === "TEACHER" ? "Teacher" : "Student";
  return (
    <div>
      <Breadcrumbs items={[{ label: portalLabel, href: `/${role.toLowerCase()}/dashboard` }, { label: "Notifications" }]} />
      <PageHeader title="Notifications" subtitle="Click a notification to open its related content and mark it as seen." actions={<Button variant="outline" onClick={markAll}>Mark all seen</Button>} />
      <Tabs tabs={[{ id: "unread", label: "Unread" }, { id: "all", label: "All" }]} active={tab} onChange={setTab} />
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {isLoading ? <Card className="p-8 text-sm text-slate-500">Loading notifications...</Card> : error ? <ErrorState message="Failed to load notifications" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No notifications" /> : (
        <div className="space-y-2">
          {items.map((notification) => {
            const href = notificationHref({
              id: str(notification.id),
              type: str(notification.type),
              resourceType: notification.resourceType ? str(notification.resourceType) : null,
              resourceId: notification.resourceId ? str(notification.resourceId) : null,
            }, role);
            const title = str(notification.title);
            const content = <>
              <span className="font-semibold text-slate-900">{title}</span>
              <Badge tone="blue">{str(notification.type)}</Badge>
            </>;
            return (
              <Card key={str(notification.id)} className={`flex items-start gap-3 p-4 ${notification.isRead !== true ? "border-l-4 border-l-brand-500" : ""}`}>
                <span className="rounded-full bg-slate-100 p-2 text-slate-500"><Bell size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {href ? <Link href={href} onClick={(event) => { void openNotification(notification, href, event); }} className="hover:underline">{content}</Link> : content}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{str(notification.message)}</p>
                  <p className="mt-1 text-xs text-slate-400">{notification.createdAt ? new Date(str(notification.createdAt)).toLocaleString() : "—"}{role === "ADMIN" && Array.isArray(notification.deliveries) ? ` · ${notification.deliveries.map((delivery) => `${str((delivery as Row).channel)}:${str((delivery as Row).status)}`).join(", ") || "No delivery rows"}` : ""}</p>
                </div>
                {notification.isRead !== true && <Button variant="outline" size="sm" onClick={() => { void markReadAction(str(notification.id)); }}>Mark seen</Button>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
