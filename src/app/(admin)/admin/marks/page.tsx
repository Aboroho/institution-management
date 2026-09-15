"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Select, SearchableSelect, Label, Breadcrumbs, Tabs, Card, Badge } from "@/components/ui";
import { CourseOfferingCell } from "@/components/course-offering-context";
import { useSearchParams } from "next/navigation";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function AdminMarksPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading...</div>}>
      <MarksContent />
    </Suspense>
  );
}

function MarksContent() {
  const qp = useSearchParams();
  const [tab, setTab] = useState(qp.get("tab") === "approvals" ? "approvals" : "overview");
  const offerings = useOfferings();
  const [offeringId, setOfferingId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");

  const { data: assessments } = useSWR(offeringId ? `mk-assess-${offeringId}` : null, () => get<Row[]>(`/assessments?courseOfferingId=${offeringId}&limit=100`).then((r) => r.data));
  const marksQuery = assessmentId ? `/marks?assessmentId=${assessmentId}` : null;
  const { data: marks, error: mErr, isLoading: mLoad, mutate: mMut } = useSWR(marksQuery, () => get<Row[]>(marksQuery!).then((r) => r.data));
  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(tab === "approvals" ? "mark-reqs" : null, () => get<Row[]>("/marks/change-requests?status=PENDING&limit=50"));

  async function review(id: string, approve: boolean) {
    try {
      await post(`/marks/change-requests/${id}/${approve ? "approve" : "reject"}`, {});
      await rMut();
    } catch (e) { alert(e instanceof ApiError ? e.message : "Review failed"); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Marks" }]} />
      <PageHeader title="Marks" subtitle="Overview and correction approvals." />
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "approvals", label: "Approvals" }]} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div><Label>Course offering</Label><SearchableSelect options={offerings} value={offeringId} onChange={(v) => { setOfferingId(v); setAssessmentId(""); }} clearLabel="Select..." /></div>
              <div><Label>Assessment</Label><Select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}><option value="">Select...</option>{(assessments ?? []).map((a) => <option key={str(a.id)} value={str(a.id)}>{str(a.title)} ({str(a.totalMarks)})</option>)}</Select></div>
            </div>
          </Card>
          {!assessmentId ? <EmptyState title="Select an assessment" /> :
            mLoad ? <LoadingSkeleton /> : mErr ? <ErrorState message="Failed to load marks" onRetry={() => mMut()} /> : (marks ?? []).length === 0 ? <EmptyState title="No marks entered" /> : (
            <Table headers={["Student ID", "Name", "Marks", "Corrections"]}>
              {(marks ?? []).map((m) => (
                <tr key={str(m.id)} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{str((m.student as Row)?.studentId)}</td>
                  <td className="px-4 py-3">{str(((m.student as Row)?.user as Row)?.name)}</td>
                  <td className="px-4 py-3 font-bold">{str(m.marksObtained)}</td>
                  <td className="px-4 py-3">{str(m.directCorrections)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {tab === "approvals" && (
        rLoad ? <LoadingSkeleton /> : rErr ? <ErrorState message="Failed to load requests" onRetry={() => rMut()} /> : (reqData?.data ?? []).length === 0 ? <EmptyState title="No pending requests" /> : (
          <Table headers={["Teacher", "Assessment", "Student", "Change", "Reason", "Requested", "Actions"]}>
            {(reqData?.data ?? []).map((r) => {
              const mark = r.mark as Row | undefined;
              const assessment = mark?.assessment as Row | undefined;
              const assessmentTitle = str(assessment?.title);
              const offeringRow = assessment?.courseOffering as Row | undefined;
              const markStudent = mark?.student as Row | undefined;
              const markStudentName = str(((markStudent?.user as Row | undefined))?.name);
              return (
              <tr key={str(r.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3">{str((r.requestedBy as Row)?.name)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className="mb-1 block font-medium text-slate-800">{assessmentTitle}</span>
                  <CourseOfferingCell offering={offeringRow} />
                </td>
                <td className="px-4 py-3">{markStudentName}</td>
                <td className="px-4 py-3 font-medium">{str(r.oldMarks)} → {str(r.newMarks)}</td>
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
