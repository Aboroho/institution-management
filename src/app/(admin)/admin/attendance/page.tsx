"use client";
import { Suspense, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, Input, Table, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, StatusBadge, Tabs } from "@/components/ui";
import { AdminAttendanceBrowser } from "@/components/attendance/admin-attendance-browser";
import { CourseOfferingCell } from "@/components/course-offering-context";
import { useSearchParams, useRouter } from "next/navigation";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admin attendance hub — the primary admin attendance entry point.
 *
 * Admins are READ-ONLY for attendance (product decision 2026-09-15): they can
 * inspect every attendance entry, open per-session student statuses and change
 * history, and approve/reject teacher change requests — but they cannot take
 * or edit attendance. There is intentionally no Take tab and no Edit action
 * here (the session list is rendered with `showEdit={false}` and the API
 * rejects admin saves with 403).
 *
 * The Attendance Report tab lists sessions for a course offering chosen through
 * the dependent Academic Year -> Trade -> Semester -> Shift -> Section ->
 * Course Offering filters (all options come from the backend).
 */
export default function AdminAttendancePage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading...</div>}>
      <AttendanceContent />
    </Suspense>
  );
}

function AttendanceContent() {
  const qp = useSearchParams();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  // Admin workflow is report/inspection-only — there is intentionally no
  // "Take Attendance" tab here. Approvals handle teacher change requests.
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "sessions");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(
    tab === "approvals" ? "att-reqs-pending" : null,
    () => get<Row[]>("/attendance/change-requests?status=PENDING&limit=50"),
  );

  async function review(id: string, approve: boolean) {
    try {
      await post(`/attendance/change-requests/${id}/${approve ? "approve" : "reject"}`, {
        reviewNote: reviewNotes[id]?.trim() || undefined,
      });
      await rMut();
      // An approval edits the session (status + update count + history), so the
      // report/history/student-status caches must not keep showing stale data.
      await globalMutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("att-report-") || key.startsWith("att-hist-") || key.startsWith("att-records-")),
        undefined,
        { revalidate: true },
      );
    } catch (e) { alert(e instanceof ApiError ? e.message : "Review failed"); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Attendance" }]} />
      <PageHeader
        title="Attendance"
        subtitle="Read-only for admins — inspect attendance entries and history, or review pending teacher change requests."
      />
      <Tabs
        tabs={[{ id: "sessions", label: "Attendance Report" }, { id: "approvals", label: "Approvals" }]}
        active={tab}
        onChange={(t) => { setTab(t); router.replace(`/admin/attendance?tab=${t}`); }}
      />

      {tab === "sessions" && <AdminAttendanceBrowser />}

      {tab === "approvals" && (
        rLoad ? <LoadingSkeleton /> : rErr ? <ErrorState message="Failed to load requests" onRetry={() => rMut()} /> : (reqData?.data ?? []).length === 0 ? <EmptyState title="No pending requests" /> : (
          <div className="space-y-4">
            {(reqData?.data ?? []).map((request) => {
              const session = request.session as Row | undefined;
              const offeringRow = session?.courseOffering as Row | undefined;
              const changes = (request.changes as Row[] | undefined) ?? [];
              const course = offeringRow?.course as Row | undefined;
              return (
                <Card key={str(request.id)} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Attendance-entry change request</h2>
                      <p className="mt-1 text-sm text-slate-600"><CourseOfferingCell offering={offeringRow} /></p>
                      <p className="mt-1 text-sm font-medium text-slate-700">{str(course?.title)} · Attendance date {str(session?.attendanceDate)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <StatusBadge status={str(request.status)} />
                      <span className="rounded-full bg-violet-50 px-3 py-1 font-semibold text-violet-800">{changes.length} student{changes.length === 1 ? "" : "s"} affected</span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div><span className="block text-xs font-semibold uppercase text-slate-500">Requesting teacher</span><span className="font-semibold">{str((request.requestedBy as Row | undefined)?.name)}</span></div>
                    <div><span className="block text-xs font-semibold uppercase text-slate-500">Submitted</span><span>{str(request.createdAt) ? new Date(str(request.createdAt)).toLocaleString() : "—"}</span></div>
                    <div><span className="block text-xs font-semibold uppercase text-slate-500">Reason</span><span>{str(request.reason)}</span></div>
                  </div>
                  <div className="mt-4">
                    <Table headers={["Roll", "Student", "Student ID", "Previous status", "Proposed status"]}>
                      {changes.map((change) => (
                        <tr key={str(change.id)} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold">{str(change.rollNumber) || "—"}</td>
                          <td className="px-4 py-3 font-semibold text-indigo-800">{str(change.studentName)}<span className="block text-xs font-normal text-slate-500">{str(change.studentEmail)}</span></td>
                          <td className="px-4 py-3 font-mono text-xs">{str(change.studentId)}</td>
                          <td className="px-4 py-3"><StatusBadge status={str(change.oldStatus)} /></td>
                          <td className="px-4 py-3"><StatusBadge status={str(change.newStatus)} /></td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-end gap-2">
                    <label className="min-w-[240px] flex-1 text-left text-xs font-semibold text-slate-600">
                      Review note (optional)
                      <Input
                        value={reviewNotes[str(request.id)] ?? ""}
                        onChange={(event) => setReviewNotes((current) => ({ ...current, [str(request.id)]: event.target.value }))}
                        placeholder="Add an approval or rejection note"
                        className="mt-1"
                      />
                    </label>
                    <Button onClick={() => review(str(request.id), true)}>Approve all changes</Button>
                    <Button variant="danger" onClick={() => review(str(request.id), false)}>Reject request</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
