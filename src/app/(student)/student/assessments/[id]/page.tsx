"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, authApi, ApiError } from "@/lib/api/client";
import { PageHeader, Button, Card, LoadingSkeleton, ErrorState, Breadcrumbs, Badge, Spinner } from "@/components/ui";
import { Upload, Download } from "lucide-react";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

export default function StudentAssessmentDetail({ params }: { params: { id: string } }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`st-assess-${params.id}`, () => get<Row>(`/assessments/${params.id}`).then((r) => r.data));
  const { data: me } = useSWR("me", () => authApi.me().then((r) => r.data));
  const studentId = (me?.student as { id: string } | undefined)?.id;

  async function upload() {
    if (!file) return;
    setErr(""); setMsg("");
    if (!file.name.toLowerCase().endsWith(".pdf")) { setErr("Only PDF files are allowed."); return; }
    if (file.size > 50 * 1024 * 1024) { setErr("File exceeds 50 MB."); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("assessmentId", params.id);
      form.append("file", file);
      const res = await fetch("/api/v1/submissions", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new ApiError(json?.error?.code ?? "INTERNAL_ERROR", json?.error?.message ?? "Upload failed", res.status);
      setMsg("Submitted successfully.");
      setFile(null);
      await mutate();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function download(submissionId: string) {
    const r = await get<{ url: string }>(`/submissions/${submissionId}/download`);
    window.open(r.data.url, "_blank");
  }

  if (isLoading) return <><PageHeader title="Assessment" /><LoadingSkeleton /></>;
  if (error || !data) return <><PageHeader title="Assessment" /><ErrorState message="Failed to load assessment" onRetry={() => mutate()} /></>;

  const mySubmission = ((data.submissions as Row[] | undefined) ?? []).find((s) => str(s.studentId) === studentId);
  const myMark = ((data.marks as Row[] | undefined) ?? []).find((m) => str(m.studentId) === studentId);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Assessments", href: "/student/assessments" }, { label: str(data.title) }]} />
      <PageHeader title={str(data.title)} subtitle={`${str(((data.courseOffering as Row)?.course as Row)?.title)} · ${str(data.type)}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Instructions</h2>
          <p className="text-sm text-slate-600">{str(data.description ?? "No instructions provided.")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="blue">Total: {str(data.totalMarks)}</Badge>
            <Badge>Pass: {str(data.passMarks)}</Badge>
            <Badge tone="amber">Due: {data.dueDate ? new Date(str(data.dueDate)).toLocaleString() : "—"}</Badge>
            {data.submitable ? <Badge tone="green">Accepts PDF submission</Badge> : <Badge>Marks only</Badge>}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Your submission & result</h2>
          {myMark !== undefined && myMark !== null ? (
            <p className="mb-3 text-sm">Your marks: <strong>{str((myMark as Row).marksObtained)} / {str(data.totalMarks)}</strong></p>
          ) : <p className="mb-3 text-sm text-slate-500">Not graded yet.</p>}
          {mySubmission ? (
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-600">Submitted {new Date(str((mySubmission as Row).submittedAt)).toLocaleString()}{(mySubmission as Row).isLate ? " (late)" : ""}</p>
              <Button variant="outline" onClick={() => download(str((mySubmission as Row).id))}><Download size={14} /> Download</Button>
            </div>
          ) : <p className="text-sm text-slate-500">No submission yet.</p>}
          {data.submitable ? (
            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium">Upload PDF (max 50 MB)</label>
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
              <Button onClick={upload} disabled={!file || uploading}>{uploading ? <Spinner /> : <Upload size={14} />} {mySubmission ? "Resubmit" : "Submit"}</Button>
              {msg && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
              {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">This assessment does not accept file submissions.</p>}
        </Card>
      </div>
    </div>
  );
}
