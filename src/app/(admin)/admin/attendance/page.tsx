"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Select, Label, Spinner, Breadcrumbs, StatusBadge, Tabs, Card } from "@/components/ui";
import { useSearchParams } from "next/navigation";

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
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "sessions");
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const sessionsQuery = offeringId ? qs({ courseOfferingId: offeringId, from: from || undefined, to: to || undefined }) : null;
  const { data: sessions, error: sErr, isLoading: sLoad, mutate: sMut } = useSWR(sessionsQuery ? `att-sessions${sessionsQuery}` : null, () => get<Row[]>(`/attendance/sessions${sessionsQuery}`).then((r) => r.data));
  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(tab === "approvals" ? "att-reqs-pending" : null, () => get<Row[]>("/attendance/change-requests?status=PENDING&limit=50"));

  async function review(id: string, approve: boolean) {
    try {
      await post(`/attendance/change-requests/${id}/${approve ? "approve" : "reject"}`, {});
      await rMut();
    } catch (e) { alert(e instanceof ApiError ? e.message : "Review failed"); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Attendance" }]} />
      <PageHeader title="Attendance" subtitle="Sessions and correction approvals." />
      <Tabs tabs={[{ id: "sessions", label: "Sessions" }, { id: "approvals", label: "Approvals" }]} active={tab} onChange={setTab} />

      {tab === "sessions" && (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <div className="md:col-span-2"><Label>Course offering</Label><Select value={offeringId} onChange={(e) => setOfferingId(e.target.value)}><option value="">Select...</option>{offerings.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
              <div><Label>From</Label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
              <div><Label>To</Label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            </div>
          </Card>
          {!offeringId ? <EmptyState title="Select a course offering" hint="Attendance sessions will appear here." /> :
            sLoad ? <LoadingSkeleton /> : sErr ? <ErrorState message="Failed to load sessions" onRetry={() => sMut()} /> : (sessions ?? []).length === 0 ? <EmptyState title="No sessions" /> : (
            <Table headers={["Date", "Present", "Absent", "Late", "Excused", "Total"]}>
              {(sessions ?? []).map((s) => {
                const recs = (s.records as Row[] | undefined) ?? [];
                const c = (st: string) => recs.filter((r) => str(r.status) === st).length;
                return (
                  <tr key={str(s.id)} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{str(s.attendanceDate).slice(0, 10)}</td>
                    <td className="px-4 py-3">{c("PRESENT")}</td>
                    <td className="px-4 py-3">{c("ABSENT")}</td>
                    <td className="px-4 py-3">{c("LATE")}</td>
                    <td className="px-4 py-3">{c("EXCUSED")}</td>
                    <td className="px-4 py-3">{recs.length}</td>
                  </tr>
                );
              })}
            </Table>
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
