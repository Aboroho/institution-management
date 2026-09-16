"use client";
/**
 * AttendanceHistoryDrawer
 *
 * Opens a side drawer for a single AttendanceSession and lists every
 * student-level change (initial entries + corrections) along with who,
 * what, when, why, and whether the change was approval-based.
 *
 * Scope: only changes belonging to the selected AttendanceSession. No
 * unrelated history is shown. Current per-student statuses live in
 * AttendanceSessionStudentsDialog (a separate action in the session list).
 */

import useSWR from "swr";
import { Dialog, LoadingSkeleton, ErrorState, EmptyState, Table, StatusBadge, Badge } from "@/components/ui";
import { CourseOfferingBadges } from "@/components/course-offering-context";
import { get } from "@/lib/api/client";
import type { AttendanceHistoryPayload } from "@/modules/attendance/attendance.types";

const str = (v: unknown) => String(v ?? "");

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
    () => get<AttendanceHistoryPayload>(`/attendance/sessions/${sessionId}/history`).then((r) => r.data),
  );

  return (
    <Dialog
      open={open}
      title="Attendance History"
      wide
      onClose={onClose}
    >
      {isLoading ? (
        <LoadingSkeleton />
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
            <div className="mt-2">
              <CourseOfferingBadges offering={data.session.courseOffering} />
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Change history (immutable)</h3>
            {data.history.length === 0 ? (
              <EmptyState title="No changes yet" hint="This session has not been modified since it was created." />
            ) : (
              <Table headers={["Date", "Student", "Roll", "Previous", "New", "By", "Role", "Reason", "Type", "Approval"]}>
                {data.history.map((h) => {
                  const student = data.students.find((s) => s.recordId === h.recordId);
                  return (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs text-slate-600">{new Date(h.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm">
                        {student ? (
                          <span className="flex flex-col">
                            <span className="font-medium">{student.name}</span>
                            <span className="font-mono text-[11px] text-slate-500">{student.studentId}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium">
                        {student?.rollNumber ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-sm">{h.oldStatus ? <StatusBadge status={h.oldStatus} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-sm font-medium"><StatusBadge status={h.newStatus} /></td>
                      <td className="px-3 py-2 text-sm">{h.changedBy.name}</td>
                      <td className="px-3 py-2 text-xs"><Badge tone="violet">{h.changedBy.role}</Badge></td>
                      <td className="px-3 py-2 text-sm text-slate-600">{h.reason}</td>
                      <td className="px-3 py-2 text-xs">
                        {h.changeType === "INITIAL_ENTRY" ? (
                          <Badge>Initial</Badge>
                        ) : h.viaApproval ? (
                          <Badge tone="violet">Approval</Badge>
                        ) : (
                          <Badge tone="amber">Direct</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.relatedChangeRequest ? (
                          <span className="flex flex-col gap-1">
                            <StatusBadge status={h.relatedChangeRequest.status} />
                            <span className="text-[11px] text-slate-500">
                              #{h.relatedChangeRequest.id.slice(0, 8)}
                              {h.relatedChangeRequest.reviewedBy
                                ? ` · by ${h.relatedChangeRequest.reviewedBy.name}`
                                : ""}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
