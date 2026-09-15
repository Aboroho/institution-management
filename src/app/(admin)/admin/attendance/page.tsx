"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, StatusBadge, Tabs, Breadcrumbs } from "@/components/ui";
import { AdminAttendanceBrowser } from "@/components/attendance/admin-attendance-browser";
import { useSearchParams, useRouter } from "next/navigation";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

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
  // Admin workflow is report/inspection-only — there is intentionally no
  // "Take Attendance" tab here. Approvals handle teacher change requests.
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "report");

  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(
    tab === "approvals" ? "att-reqs-pending" : null,
    () => get<Row[]>("/attendance/change-requests?status=PENDING&limit=50"),
  );

  async function review(id: string, approve: boolean) {
    try {
      await post(`/attendance/change-requests/${id}/${approve ? "approve" : "reject"}`, {});
      await rMut();
    } catch (e) { alert(e instanceof ApiError ? e.message : "Review failed"); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Attendance" }]} />
      <PageHeader
        title="Attendance"
        subtitle="Inspect historical attendance sessions, or review pending teacher change requests."
      />
      <Tabs
        tabs={[{ id: "report", label: "Attendance Report" }, { id: "approvals", label: "Approvals" }]}
        active={tab}
        onChange={(t) => { setTab(t); router.replace(`/admin/attendance?tab=${t}`); }}
      />

      {tab === "report" && <AdminAttendanceBrowser />}

      {tab === "approvals" && (
        rLoad ? <LoadingSkeleton /> : rErr ? <ErrorState message="Failed to load requests" onRetry={() => rMut()} /> : (reqData?.data ?? []).length === 0 ? <EmptyState title="No pending requests" /> : (
          <Table headers={["Teacher", "Course", "Student", "Change", "Reason", "Requested", "Actions"]}>
            {(reqData?.data ?? []).map((r) => {
              const record = r.record as Row | undefined;
              const session = record?.session as Row | undefined;
              const offering = session?.courseOffering as Row | undefined;
              const courseTitle = str((offering?.course as Row | undefined)?.title);
              const sectionName = str((offering?.section as Row | undefined)?.name);
              const studentUser = ((record?.student as Row | undefined)?.user as Row | undefined);
              return (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3">{str((r.requestedBy as Row)?.name)}</td>
                <td className="px-4 py-3 text-sm">{courseTitle} · {sectionName}</td>
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
