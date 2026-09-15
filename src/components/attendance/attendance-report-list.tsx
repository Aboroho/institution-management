"use client";
/**
 * AttendanceReportList
 *
 * Dedicated historical attendance-session list. Server-side paginated, with
 * a date-range filter and History/Edit actions per row.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  Card, Button, Input, LoadingSkeleton, EmptyState, ErrorState, Pagination, Label,
} from "@/components/ui";
import { get, qs } from "@/lib/api/client";
import { History, PencilLine, FilterX, Users } from "lucide-react";
import { AttendanceDateBadge, weekdayName, monthYearLabel } from "./date-display";
import { AttendanceHistoryDrawer } from "./attendance-history-drawer";
import { AttendanceSessionStudentsDialog } from "./attendance-session-students-dialog";
import { offeringContextLabel } from "@/components/course-offering-context";
import type { AttendanceReportItem } from "@/modules/attendance/attendance.types";

type Row = Record<string, unknown>;

const DEFAULT_PAGE_SIZE = 20;

function pluralUpdates(n: number) {
  return `Updated: ${n} ${n === 1 ? "time" : "times"}`;
}

export function AttendanceReportList({
  offeringId,
  offeringTitle,
  offering,
  editBasePath,
  showEdit = true,
}: {
  offeringId: string;
  offeringTitle?: string;
  /**
   * Full offering row (course + trade/semester/shift/section). When provided,
   * every session card names the complete context so staff can verify they are
   * looking at the right course. Falls back to `offeringTitle` when absent.
   */
  offering?: Row;
  /** Base path used to navigate to "Edit" for a given session (date appended). */
  editBasePath?: string;
  /**
   * Show the per-session Edit action. Teachers: true. Admins: MUST be false —
   * admins are read-only for attendance (view entries + history, approve
   * change requests) per product decision 2026-09-15.
   */
  showEdit?: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [studentsFor, setStudentsFor] = useState<string | null>(null);

  // Switching course offering (admin dependent filters) must not keep a page
  // number that the new offering's session list may not have.
  useEffect(() => {
    setPage(1);
  }, [offeringId]);

  const query = qs({
    page,
    pageSize,
    from: appliedFrom || undefined,
    to: appliedTo || undefined,
  });

  const { data, error, isLoading, mutate } = useSWR(
    `att-report-${offeringId}-${query}`,
    () => get<AttendanceReportItem[]>(`/course-offerings/${offeringId}/attendance/sessions${query}`),
    { keepPreviousData: true },
  );

  // Keep the full response: `data` is the session page and `meta.total` drives
  // pagination. (Stripping meta here used to pin the pager at "0 records".)
  const items = data?.data ?? [];
  const total = Number(data?.meta?.total ?? 0);
  const hasDateFilter = Boolean(appliedFrom || appliedTo);

  function applyFilter() {
    setAppliedFrom(from);
    setAppliedTo(to);
    setPage(1);
  }
  function resetFilter() {
    setFrom(""); setTo("");
    setAppliedFrom(""); setAppliedTo("");
    setPage(1);
  }

  function openEdit(item: AttendanceReportItem) {
    if (!editBasePath) return;
    router.push(`${editBasePath}?date=${encodeURIComponent(item.attendanceDate)}`);
  }

  const emptyMessage = useMemo(() => {
    if (hasDateFilter) return "No attendance records found for the selected date range.";
    return "No attendance records found.";
  }, [hasDateFilter]);

  const sessionSubtitle = offering
    ? offeringContextLabel(offering)
    : (offeringTitle ?? "Attendance session");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="att-from">From</Label>
            <Input
              id="att-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
              max={to || undefined}
            />
          </div>
          <div>
            <Label htmlFor="att-to">To</Label>
            <Input
              id="att-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-auto"
              min={from || undefined}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilter}>
              <FilterX size={14} /> Apply
            </Button>
            <Button variant="outline" onClick={resetFilter} disabled={!hasDateFilter}>
              Reset
            </Button>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <label htmlFor="att-page-size" className="mb-1 block text-sm font-medium text-slate-700">Page size</label>
            <select
              id="att-page-size"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              aria-label="Page size"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {isLoading && items.length === 0 ? (
        <LoadingSkeleton rows={5} />
      ) : error ? (
        <ErrorState message="Failed to load attendance sessions" onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState title={emptyMessage} hint="Sessions appear here after attendance is taken for this offering." />
      ) : (
        <div className="space-y-3 pb-8">
          {items.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <AttendanceDateBadge iso={s.attendanceDate} />
                <div className="min-w-[140px] flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {weekdayName(s.attendanceDate)} · {monthYearLabel(s.attendanceDate)}
                  </p>
                  <p className="text-xs text-slate-500">{sessionSubtitle}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <Stat label="Total" value={s.summary.total} tone="slate" />
                    <Stat label="Present" value={s.summary.present} tone="green" />
                    <Stat label="Absent" value={s.summary.absent} tone="red" />
                    <Stat label="Late" value={s.summary.late} tone="amber" />
                    <Stat label="Excused" value={s.summary.excused} tone="blue" />
                    <Stat label="Updated" value={pluralUpdates(s.updateCount)} tone="violet" />
                  </dl>
                </div>
                <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:flex-col">
                  <Button variant="outline" onClick={() => setStudentsFor(s.id)}>
                    <Users size={16} /> Student Status
                  </Button>
                  <Button variant="outline" onClick={() => setHistoryFor(s.id)}>
                    <History size={16} /> History
                  </Button>
                  {showEdit && editBasePath && (
                    <Button onClick={() => openEdit(s)}>
                      <PencilLine size={16} /> Edit
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > 0 && (
        <Pagination
          page={page}
          limit={pageSize}
          total={total}
          onPage={(p) => setPage(p)}
        />
      )}

      <AttendanceSessionStudentsDialog
        sessionId={studentsFor}
        open={studentsFor !== null}
        onClose={() => setStudentsFor(null)}
      />

      <AttendanceHistoryDrawer
        sessionId={historyFor}
        open={historyFor !== null}
        onClose={() => setHistoryFor(null)}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "slate" | "green" | "red" | "amber" | "blue" | "violet" }) {
  const colors: Record<string, string> = {
    slate: "text-slate-700",
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    violet: "text-violet-700",
  };
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-base font-semibold ${colors[tone]}`}>{value}</dd>
    </div>
  );
}
