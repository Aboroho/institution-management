"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, SearchableSelect, Label, Breadcrumbs, StatusBadge, Tabs, Card } from "@/components/ui";
import { AttendanceReportList } from "@/components/attendance/attendance-report-list";
import { CourseOfferingBanner, CourseOfferingCell } from "@/components/course-offering-context";
import { useSearchParams, useRouter } from "next/navigation";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

/**
 * Admin attendance hub.
 *
 * Admins are READ-ONLY for attendance (product decision 2026-09-15): they can
 * inspect every attendance entry, open per-session student statuses and change
 * history, and approve/reject teacher change requests — but they cannot take
 * or edit attendance. There is intentionally no Take tab and no Edit action on
 * this screen (the report list is rendered with `showEdit={false}`).
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
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "sessions");
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");

  // Full offering row for the context banner + enriched session subtitles.
  const { data: offering, error: offErr } = useSWR(
    offeringId ? `off-${offeringId}` : null,
    () => get<Row>(`/course-offerings/${offeringId}`).then((r) => r.data),
  );

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
        subtitle="Read-only for admins — inspect attendance entries and history, or review pending teacher change requests."
      />
      <Tabs
        tabs={[{ id: "sessions", label: "Attendance Report" }, { id: "approvals", label: "Approvals" }]}
        active={tab}
        onChange={(t) => { setTab(t); router.replace(`/admin/attendance?tab=${t}`); }}
      />

      {tab === "sessions" && (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <Label>Course offering</Label>
                <SearchableSelect
                  options={offerings}
                  value={offeringId}
                  onChange={(v) => setOfferingId(v)}
                  clearLabel="Select a course offering..."
                />
              </div>
            </div>
          </Card>
          {!offeringId ? (
            <EmptyState
              title="Select a course offering"
              hint="Pick a course offering above to see its attendance report, student statuses and change history."
            />
          ) : offErr ? (
            <ErrorState message="Failed to load course offering" />
          ) : !offering ? (
            <LoadingSkeleton />
          ) : (
            <>
              <CourseOfferingBanner offering={offering} eyebrow="Viewing attendance for" />
              <AttendanceReportList
                offeringId={offeringId}
                offering={offering}
                editBasePath={`/admin/course-offerings/${offeringId}/attendance/edit`}
                showEdit={false}
              />
            </>
          )}
        </>
      )}

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
