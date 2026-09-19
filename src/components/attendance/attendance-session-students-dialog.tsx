"use client";
/**
 * AttendanceSessionStudentsDialog
 *
 * Read-only view of every student's status in a single AttendanceSession.
 * The backend returns the COMPLETE section roster (students without a record
 * yet appear as NOT_MARKED) so the dialog can filter by roll on the frontend
 * without pagination or extra endpoints.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Dialog, TableSkeleton, ErrorState, EmptyState, Table, StatusBadge, Label, Input } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import { get } from "@/lib/api/client";
import { filterByRoll } from "@/modules/attendance/attendance.permissions";
import type { AttendanceSessionRosterPayload } from "@/modules/attendance/attendance.types";

const str = (v: unknown) => String(v ?? "");

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
    () => get<AttendanceSessionRosterPayload>(`/attendance/sessions/${sessionId}/records`).then((r) => r.data),
  );
  const [rollQuery, setRollQuery] = useState("");

  const filtered = useMemo(
    () => filterByRoll(data?.records ?? [], rollQuery),
    [data, rollQuery],
  );

  function close() {
    setRollQuery("");
    onClose();
  }

  return (
    <Dialog open={open} title="Student status — recorded attendance" wide onClose={close}>
      {isLoading ? (
        <TableSkeleton columns={3} rows={6} label="Loading students" />
      ) : error ? (
        <ErrorState message="Failed to load student statuses" />
      ) : !data ? (
        <EmptyState title="No data" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 via-violet-50 to-emerald-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{str(data.session.courseOffering.course.title)}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">{data.session.attendanceDate}</span>
            </div>
            <div className="mt-2">
              <CourseOfferingBadges offering={data.session.courseOffering} />
            </div>
          </div>

          <div className="max-w-xs">
            <Label htmlFor="student-status-roll">Search by Roll</Label>
            <Input
              id="student-status-roll"
              placeholder="e.g. 1023"
              value={rollQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRollQuery(e.target.value)}
              aria-label="Search by roll number"
            />
          </div>

          {data.records.length === 0 ? (
            <EmptyState title="No student records" />
          ) : filtered.length === 0 ? (
            <EmptyState title={`No students match roll "${rollQuery.trim()}"`} hint="Clear the search to see the full section list." />
          ) : (
            <>
              {rollQuery.trim() && (
                <p className="text-xs text-slate-500" role="status">
                  Showing {filtered.length} of {data.records.length} students
                </p>
              )}
              <Table headers={["Roll", "Status", "Name", ]}>
                {filtered.map((r) => (
                  <tr key={r.id ?? `missing-${r.studentId}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-bold">{r.rollNumber ?? <span className="text-slate-400">—</span>}</td>
                    {/* <td className="px-4 py-2 font-mono text-xs">{r.studentId}</td> */}
                      <td className="px-4 py-2">
                      {r.status === "NOT_MARKED" ? (
                        <span className="text-sm text-slate-400">Not marked</span>
                      ) : (
                        <>
                          <StatusBadge status={r.status} />
                          {r.note && <span className="mt-1 block text-[11px] text-slate-500">{r.note}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-col">
                        <span className="font-medium">{r.studentName}</span>
                        <span className="text-[11px] text-slate-500">{r.studentEmail}</span>
                      </span>
                    </td>
                  
                  </tr>
                ))}
              </Table>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
