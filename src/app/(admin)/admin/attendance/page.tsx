"use client";
import { Suspense, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Breadcrumbs, StatusBadge, Tabs } from "@/components/ui";
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

  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(
    tab === "approvals" ? "att-reqs-pending" : null,
    () => get<Row[]>("/attendance/change-requests?status=PENDING&limit=50"),
  );

  async function review(id: string, approve: boolean) {
    try {
      await post(`/attendance/change-requests/${id}/${approve ? "approve" : "reject"}`, {});
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
          <Table headers={["Teacher", "Course", "Student", "Change", "Reason", "Requested", "Actions"]}>
            {(reqData?.data ?? []).map((r) => {
              const record = r.record as Row | undefined;
              const session = record?.session as Row | undefined;
              const offeringRow = session?.courseOffering as Row | undefined;
              const studentUser = ((record?.student as Row | undefined)?.user as Row | undefined);
              return (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3">{str((r.requestedBy as Row)?.name)}</td>
                <td className="px-4 py-3 text-sm"><CourseOfferingCell offering={offeringRow} /></td>
                <td className="px-4 py-3">{str(studentUser?.name)}</td>
                <td className="px-4 py-3"><span className="flex items-center gap-1"><StatusBadge status={str(r.oldStatus)} /> → <StatusBadge status={str(r.newStatus)} /></span></td>
                <td className="px-4 py-3 text-sm text-slate-600">{str(r.reason).slice(0, 80)}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{str(r.createdAt).slice(0, 10)}</td>
                <td className="px-4 py-3"><span className="flex gap-1">
                  <Button onClick={() => review(str(r.id), true)}>Approve</Button>
                  <Button variant="danger" onClick={() => review(str(r.id), false)}>Reject</Button>
                </span></td>
              </tr>
              );
            })}
          </Table>
        )
      )}
    </div>
  );
}
