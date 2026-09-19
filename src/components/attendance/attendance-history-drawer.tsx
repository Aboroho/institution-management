"use client";

/** Session-scoped immutable attendance history, grouped by correction operation. */

import useSWR from "swr";
import { Dialog, TableSkeleton, ErrorState, EmptyState, Table, StatusBadge, Badge } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import { get } from "@/lib/api/client";
import type { AttendanceHistoryEntry, AttendanceHistoryPayload } from "@/modules/attendance/attendance.types";

const str = (value: unknown) => String(value ?? "");

type OperationGroup = {
  id: string;
  entries: AttendanceHistoryEntry[];
};

export function AttendanceHistoryDrawer({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const key = sessionId ? `att-hist-${sessionId}` : null;
  const { data, error, isLoading } = useSWR(
    key,
    () => get<AttendanceHistoryPayload>(`/attendance/sessions/${sessionId}/history`).then((response) => response.data),
  );

  const groups = groupHistory(data?.history ?? []);

  return (
    <Dialog open={open} title="Attendance History" wide onClose={onClose}>
      {isLoading ? (
        <TableSkeleton columns={9} rows={4} label="Loading correction history" />
      ) : error ? (
        <ErrorState message="Failed to load history" />
      ) : !data ? (
        <EmptyState title="No history" />
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 via-violet-50 to-emerald-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{str(data.session.courseOffering.course.title)}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">{data.session.attendanceDate}</span>
            </div>
            <div className="mt-2"><CourseOfferingBadges offering={data.session.courseOffering} /></div>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Change history (immutable)</h3>
            {groups.length === 0 ? (
              <EmptyState title="No changes yet" hint="This session has not been modified since it was created." />
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={group.entries[0].viaApproval ? "violet" : "amber"}>
                        {group.entries[0].changeType === "INITIAL_ENTRY" ? "Initial entry" : group.entries[0].viaApproval ? "Approved request" : "Direct correction"}
                      </Badge>
                      <span className="font-semibold text-slate-700">{group.entries.length} student change{group.entries.length === 1 ? "" : "s"} in this operation</span>
                      {group.entries[0].requestId && <span className="font-mono text-xs text-slate-500">Request {group.entries[0].requestId.slice(0, 8)}</span>}
                      {group.entries[0].operationId && <span className="font-mono text-xs text-slate-400">Operation {group.entries[0].operationId.slice(0, 8)}</span>}
                    </div>
                    <Table headers={["Date", "Student", "Roll", "Previous", "New", "By", "Role", "Reason", "Approval"]}>
                      {group.entries.map((history) => {
                        const student = data.students.find((item) => item.recordId === history.recordId);
                        return (
                          <tr key={history.id} className="hover:bg-white">
                            <td className="px-3 py-2 text-xs text-slate-600">{new Date(history.timestamp).toLocaleString()}</td>
                            <td className="px-3 py-2 text-sm">
                              {student ? <span className="flex flex-col"><span className="font-medium">{student.name}</span><span className="font-mono text-[11px] text-slate-500">{student.studentId}</span></span> : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-sm font-medium">{student?.rollNumber ?? <span className="text-slate-400">—</span>}</td>
                            <td className="px-3 py-2 text-sm">{history.oldStatus ? <StatusBadge status={history.oldStatus} /> : <span className="text-slate-400">—</span>}</td>
                            <td className="px-3 py-2 text-sm font-medium"><StatusBadge status={history.newStatus} /></td>
                            <td className="px-3 py-2 text-sm">{history.changedBy.name}</td>
                            <td className="px-3 py-2 text-xs"><Badge tone="violet">{history.changedBy.role}</Badge></td>
                            <td className="px-3 py-2 text-sm text-slate-600">{history.reason}</td>
                            <td className="px-3 py-2 text-xs">
                              {history.relatedChangeRequest ? (
                                <span className="flex flex-col gap-1"><StatusBadge status={history.relatedChangeRequest.status} /><span className="text-[11px] text-slate-500">{history.relatedChangeRequest.reviewedBy ? `by ${history.relatedChangeRequest.reviewedBy.name}` : "Pending review"}</span></span>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function groupHistory(entries: AttendanceHistoryEntry[]): OperationGroup[] {
  const grouped = new Map<string, AttendanceHistoryEntry[]>();
  for (const entry of entries) {
    const id = entry.operationId ?? entry.requestId ?? entry.id;
    const current = grouped.get(id) ?? [];
    current.push(entry);
    grouped.set(id, current);
  }
  return [...grouped.entries()].map(([id, groupEntries]) => ({ id, entries: groupEntries }));
}
