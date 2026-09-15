"use client";
/**
 * AttendanceSessionStudentsDialog
 *
 * Read-only view of every student's CURRENT status in a single
 * AttendanceSession (roll, ID, name, status, direct corrections used).
 * Change history lives in AttendanceHistoryDrawer — the session list offers
 * the two as separate actions.
 */

import useSWR from "swr";
import { Dialog, LoadingSkeleton, ErrorState, EmptyState, Table, StatusBadge } from "@/components/ui";
import { get } from "@/lib/api/client";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

type RecordsPayload = {
  session: {
    id: string;
    attendanceDate: string;
    courseOffering: { course: { title: string; code: string }; section: { name: string } };
  };
  records: {
    id: string;
    rollNumber: number | null;
    studentId: string;
    studentName: string;
    studentEmail: string;
    status: string;
    note: string | null;
    directCorrections: number;
  }[];
};

export function AttendanceSessionStudentsDialog({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const key = sessionId ? `att-records-${sessionId}` : null;
  const { data, error, isLoading } = useSWR(
    key,
    () => get<RecordsPayload>(`/attendance/sessions/${sessionId}/records`).then((r) => r.data),
  );

  return (
    <Dialog open={open} title="Student Status" wide onClose={onClose}>
      {isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message="Failed to load student statuses" />
      ) : !data ? (
        <EmptyState title="No data" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700">{str(data.session.courseOffering.course.title)}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-600">Section {str(data.session.courseOffering.section.name)}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-600">{data.session.attendanceDate}</span>
            </div>
          </div>

          {data.records.length === 0 ? (
            <EmptyState title="No student records" />
          ) : (
            <Table headers={["Roll", "Student ID", "Name", "Status", "Direct corrections"]}>
              {data.records.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{r.rollNumber ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.studentId}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{r.studentName}</span>
                      <span className="text-[11px] text-slate-500">{r.studentEmail}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                    {r.note && <span className="mt-1 block text-[11px] text-slate-500">{r.note}</span>}
                  </td>
                  <td className="px-4 py-2 text-sm">{r.directCorrections}/2 used</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </Dialog>
  );
}
