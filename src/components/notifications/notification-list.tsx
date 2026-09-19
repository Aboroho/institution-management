"use client";

/**
 * Notification inbox, shared by all three portals.
 *
 * Fixes three things the previous version got wrong:
 *   1. "Mark seen" gave no feedback at all — the row simply changed later, or
 *      silently failed. Each row now has its own busy state, and the unread
 *      badge in the shell is revalidated only after the request succeeds.
 *   2. Long messages were dumped in full into the list. They are previewed and
 *      expandable in place, and the expand control stops propagation so it can
 *      never trigger the row's navigation.
 *   3. Loading was a bare "Loading notifications..." card; it is now a skeleton
 *      shaped like the rows it replaces.
 */

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { notificationHref, type NotificationViewerRole } from "@/lib/notifications/links";
import {
  Badge, Breadcrumbs, Button, Card, EmptyState, ErrorState, ExpandableText,
  PageHeader, StatusMessage, Tabs, Tooltip,
} from "@/components/ui";
import { Bell } from "lucide-react";

interface Row { [key: string]: unknown }
const str = (value: unknown) => String(value ?? "");

function NotificationSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading notifications" aria-live="polite">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="flex items-start gap-3 p-4">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-20 animate-pulse rounded-full bg-slate-100" />
            </div>
            <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-slate-100" />
            <div className="mt-1.5 h-3 w-28 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-7 w-24 shrink-0 animate-pulse rounded-lg bg-slate-100" />
        </Card>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function NotificationList({ role }: { role: NotificationViewerRole }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [tab, setTab] = useState("unread");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const query = qs({ limit: 50, unread: tab === "unread" ? "true" : undefined });
  const { data, error, isLoading, mutate } = useSWR(`notifications-${role}${query}`, () => get<Row[]>(`/notifications${query}`), {
    keepPreviousData: true,
  });
  const items = (data?.data ?? []) as Row[];
  const unreadCount = Number((data?.meta as Row | undefined)?.unreadCount ?? 0);
  const initialLoading = isLoading && !data;

  async function markRead(id: string) {
    await post(`/notifications/${id}/read`, {});
    // Refresh both the list and the shell badge only after the write landed, so
    // the count never shows a state the server has not accepted.
    await Promise.all([mutate(), globalMutate("notif-count")]);
  }

  async function markReadAction(id: string) {
    if (busyId) return;
    setActionError("");
    setBusyId(id);
    try {
      await markRead(id);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen.");
    } finally {
      setBusyId("");
    }
  }

  async function openNotification(notification: Row, href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (notification.isRead === true) return;
    event.preventDefault();
    setBusyId(str(notification.id));
    try {
      await markRead(str(notification.id));
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "The notification could not be marked as seen.");
    } finally {
      setBusyId("");
      // Navigation happens regardless: failing to record "seen" must not block
      // the user from reading the thing the notification points at.
      router.push(href);
    }
  }

  async function markAll() {
    if (markingAll) return;
    setActionError("");
    setMarkingAll(true);
    try {
      await post("/notifications/read-all", {});
      await Promise.all([mutate(), globalMutate("notif-count")]);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to mark notifications as seen.");
    } finally {
      setMarkingAll(false);
    }
  }

  const portalLabel = role === "ADMIN" ? "Admin" : role === "TEACHER" ? "Teacher" : "Student";

  return (
    <div>
      <Breadcrumbs items={[{ label: portalLabel, href: `/${role.toLowerCase()}/dashboard` }, { label: "Notifications" }]} />
      <PageHeader
        title="Notifications"
        subtitle="Open a notification to jump to its related content."
        actions={
          <Tooltip content="Marks every unread notification as seen">
            <Button
              variant="outline"
              loading={markingAll}
              loadingText="Marking…"
              disabled={unreadCount === 0}
              onClick={() => void markAll()}
            >
              Mark all seen
            </Button>
          </Tooltip>
        }
      />
      <Tabs
        tabs={[{ id: "unread", label: "Unread", count: unreadCount }, { id: "all", label: "All" }]}
        active={tab}
        onChange={setTab}
        label="Notification filters"
      />

      {actionError && <StatusMessage tone="error" onDismiss={() => setActionError("")}>{actionError}</StatusMessage>}

      {initialLoading ? (
        <NotificationSkeleton />
      ) : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : "Failed to load notifications"} onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={tab === "unread" ? "Nothing unread" : "No notifications"}
          hint={tab === "unread" ? "New approvals, notices and results will show up here." : undefined}
        />
      ) : (
        <div className="space-y-2">
          {items.map((notification) => {
            const id = str(notification.id);
            const href = notificationHref({
              id,
              type: str(notification.type),
              resourceType: notification.resourceType ? str(notification.resourceType) : null,
              resourceId: notification.resourceId ? str(notification.resourceId) : null,
            }, role);
            const unread = notification.isRead !== true;
            const title = str(notification.title);
            const heading = (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{title}</span>
                <Badge tone="blue">{str(notification.type).replace(/_/g, " ")}</Badge>
                {/* Unread is signalled by text + border, not by colour alone. */}
                {unread && <span className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Unread</span>}
              </span>
            );
            const deliveries = role === "ADMIN" && Array.isArray(notification.deliveries)
              ? notification.deliveries.map((delivery) => `${str((delivery as Row).channel)}: ${str((delivery as Row).status)}`).join(", ")
              : "";

            return (
              <Card key={id} className={`flex items-start gap-3 p-4 ${unread ? "border-l-4 border-l-brand-500" : ""}`}>
                <span className="rounded-full bg-slate-100 p-2 text-slate-500" aria-hidden="true"><Bell size={16} /></span>
                <div className="min-w-0 flex-1">
                  {href ? (
                    <Link
                      href={href}
                      onClick={(event) => { void openNotification(notification, href, event); }}
                      className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {heading}
                    </Link>
                  ) : heading}
                  <ExpandableText className="mt-1" text={str(notification.message)} lines={2} />
                  <p className="mt-1.5 text-xs text-slate-400">
                    {notification.createdAt ? new Date(str(notification.createdAt)).toLocaleString() : "—"}
                    {deliveries && <span> · {deliveries}</span>}
                  </p>
                </div>
                {unread && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    loading={busyId === id}
                    loadingText="Saving…"
                    disabled={Boolean(busyId) && busyId !== id}
                    aria-label={`Mark "${title}" as seen`}
                    onClick={() => void markReadAction(id)}
                  >
                    Mark seen
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
