"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, SearchableSelect, Label, Spinner, Breadcrumbs, StatusBadge, Tabs, Card } from "@/components/ui";
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
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "sessions");
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");

  const sessionsQuery = offeringId ? qs({ courseOfferingId: offeringId }) : null;
  const { data: sessions, error: sErr, isLoading: sLoad, mutate: sMut } = useSWR(
    sessionsQuery ? `att-sessions${sessionsQuery}` : null,
    () => get<Row[]>(`/attendance/sessions${sessionsQuery}`).then((r) => r.data),
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
        subtitle="Pick a course offering to inspect historical sessions, or review pending change requests."
      />
      <Tabs
        tabs={[{ id: "sessions", label: "Sessions" }, { id: "approvals", label: "Approvals" }]}
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
              hint="Pick a course offering above to open its dedicated Attendance Report."
            />
          ) : sLoad ? (
            <LoadingSkeleton />
          ) : sErr ? (
            <ErrorState message="Failed to load sessions" onRetry={() => sMut()} />
          ) : (
            <Card className="p-6 text-center">
              <p className="text-sm text-slate-600">
                The historical Attendance Report lives at a dedicated URL for this offering.
              </p>
              <a
                href={`/admin/course-offerings/${offeringId}/attendance?tab=report`}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Open Attendance Report
              </a>
            </Card>
          )}
        </>
      )}

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
