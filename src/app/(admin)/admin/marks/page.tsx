"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, TableSkeleton, EmptyState, ErrorState, Select, SearchableSelect, Label, Breadcrumbs, Tabs, Card, StatusMessage, Tooltip, InlineLoading } from "@/components/ui";
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

  const [reviewing, setReviewing] = useState<{ id: string; approve: boolean } | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewDone, setReviewDone] = useState("");

  const { data: assessments, isLoading: assessmentsLoading } = useSWR(offeringId ? `mk-assess-${offeringId}` : null, () => get<Row[]>(`/assessments?courseOfferingId=${offeringId}&limit=100`).then((r) => r.data));
  const marksQuery = assessmentId ? `/marks?assessmentId=${assessmentId}` : null;
  const { data: marks, error: mErr, isLoading: mLoad, mutate: mMut } = useSWR(marksQuery, () => get<Row[]>(marksQuery!).then((r) => r.data));
  const { data: reqData, error: rErr, isLoading: rLoad, mutate: rMut } = useSWR(tab === "approvals" ? "mark-reqs" : null, () => get<Row[]>("/marks/change-requests?status=PENDING&limit=50"));

  async function review(id: string, approve: boolean) {
    if (reviewing) return;
    setReviewing({ id, approve });
    setReviewError("");
    setReviewDone("");
    try {
      await post(`/marks/change-requests/${id}/${approve ? "approve" : "reject"}`, {});
      await rMut();
      setReviewDone(approve ? "Mark correction approved." : "Mark correction rejected.");
    } catch (e) {
      setReviewError(e instanceof ApiError ? e.message : "The review could not be saved. Please try again.");
    } finally {
      setReviewing(null);
    }
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
              <div>
                <span className="mb-1 flex items-center gap-2">
                  <Label>Assessment</Label>
                  {assessmentsLoading && <span className="-mt-1"><InlineLoading label="Loading assessments…" /></span>}
                </span>
                <Select value={assessmentId} disabled={!offeringId || assessmentsLoading} aria-label="Assessment" onChange={(e) => setAssessmentId(e.target.value)}>
                  <option value="">{offeringId ? "Select..." : "Choose a course offering first"}</option>
                  {(assessments ?? []).map((a) => <option key={str(a.id)} value={str(a.id)}>{str(a.title)} ({str(a.totalMarks)})</option>)}
                </Select>
              </div>
            </div>
          </Card>
          {!assessmentId ? <EmptyState title="Select an assessment" hint="Pick a course offering and one of its assessments to see the entered marks." /> :
            mLoad ? <TableSkeleton columns={4} rows={6} label="Loading marks" /> : mErr ? <ErrorState message="Failed to load marks" onRetry={() => mMut()} /> : (marks ?? []).length === 0 ? <EmptyState title="No marks entered" hint="Marks appear here once the assigned teacher submits them." /> : (
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
        <>
        {reviewError && <StatusMessage tone="error" onDismiss={() => setReviewError("")}>{reviewError}</StatusMessage>}
        {reviewDone && <StatusMessage tone="success" onDismiss={() => setReviewDone("")}>{reviewDone}</StatusMessage>}
        {rLoad ? <TableSkeleton columns={7} rows={5} label="Loading change requests" /> : rErr ? <ErrorState message="Failed to load requests" onRetry={() => rMut()} /> : (reqData?.data ?? []).length === 0 ? <EmptyState title="No pending requests" hint="Teacher mark corrections that need approval will appear here." /> : (
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
                  <Tooltip content={`Replaces the recorded mark with ${str(r.newMarks)}.`}>
                    <Button
                      size="sm"
                      loading={reviewing?.id === str(r.id) && reviewing.approve}
                      loadingText="…"
                      disabled={Boolean(reviewing) && reviewing?.id !== str(r.id)}
                      onClick={() => void review(str(r.id), true)}
                    >Approve</Button>
                  </Tooltip>
                  <Tooltip content="Keeps the current mark; the teacher is notified.">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={reviewing?.id === str(r.id) && !reviewing.approve}
                      loadingText="…"
                      disabled={Boolean(reviewing) && reviewing?.id !== str(r.id)}
                      onClick={() => void review(str(r.id), false)}
                    >Reject</Button>
                  </Tooltip>
                </span></td>
              </tr>
              );
            })}
          </Table>
        )}
        </>
      )}
    </div>
  );
}
