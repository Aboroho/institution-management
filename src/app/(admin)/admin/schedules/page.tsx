"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, post, qs, ApiError } from "@/lib/api/client";
import { useAcademicYears, useTrades, useSemesters, useShifts, useSections, useOfferings } from "@/components/academic-options";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Dialog, Input, Select, SearchableSelect, Label, FieldError, Spinner, Breadcrumbs, Card } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";
import { CourseOfferingBadges } from "@/components/course-offering-context";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function SchedulesPage() {
  const years = useAcademicYears();
  const trades = useTrades();
  const shifts = useShifts();
  const [f, setF] = useState<Record<string, string>>({});
  const semesters = useSemesters(f.tradeId || undefined);
  const sections = useSections({ academicYearId: f.academicYearId || undefined, tradeId: f.tradeId || undefined, semesterId: f.semesterId || undefined, shiftId: f.shiftId || undefined });
  const offerings = useOfferings();
  const [dialog, setDialog] = useState(false);
  const [offeringId, setOfferingId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Row[]>([{ weekday: 1, startTime: "09:00", endTime: "10:00", room: "" }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const query = qs({ ...f });
  const { data, error, isLoading, mutate } = useSWR(`schedules${query}`, () => get<Row[]>(`/schedules${query}`).then((r) => r.data));
  const versions = data ?? [];

  function setFilter(k: string, v: string) {
    const nf = { ...f };
    if (!v) delete nf[k]; else nf[k] = v;
    setF(nf);
  }

  async function save() {
    setSaving(true); setFormError("");
    try {
      await post("/schedules", { courseOfferingId: offeringId, effectiveFrom: new Date(effectiveFrom).toISOString(), items: items.map((i) => ({ weekday: Number(i.weekday), startTime: str(i.startTime), endTime: str(i.endTime), room: str(i.room) || undefined })) });
      setDialog(false); setOfferingId(""); setItems([{ weekday: 1, startTime: "09:00", endTime: "10:00", room: "" }]); await mutate();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Schedules" }]} />
      <PageHeader title="Schedules" subtitle="Versioned per course offering — history preserved." actions={<Button onClick={() => setDialog(true)}><Plus size={16} /> New version</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <SearchableSelect options={years} value={f.academicYearId ?? ""} onChange={(v) => setFilter("academicYearId", v)} ariaLabel="Year" clearLabel="All years" placeholder="All years" />
        <SearchableSelect options={trades} value={f.tradeId ?? ""} onChange={(v) => setFilter("tradeId", v)} ariaLabel="Trade" clearLabel="All trades" placeholder="All trades" />
        <Select value={f.semesterId ?? ""} onChange={(e) => setFilter("semesterId", e.target.value)} aria-label="Semester"><option value="">All semesters</option>{semesters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.shiftId ?? ""} onChange={(e) => setFilter("shiftId", e.target.value)} aria-label="Shift"><option value="">All shifts</option>{shifts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Select value={f.sectionId ?? ""} onChange={(e) => setFilter("sectionId", e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load schedules" onRetry={() => mutate()} /> : versions.length === 0 ? (
        <EmptyState title="No schedules" action={<Button onClick={() => setDialog(true)}><Plus size={16} /> New version</Button>} />
      ) : (
        <div className="space-y-4">
          {versions.map((v) => (
            <Card key={str(v.id)} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {str(((v.courseOffering as Row)?.course as Row)?.title)}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      {str(((v.courseOffering as Row)?.course as Row)?.code)} · v{str(v.version)} · from {str(v.effectiveFrom).slice(0, 10)}
                    </span>
                  </p>
                  <div className="mt-1.5">
                    <CourseOfferingBadges offering={v.courseOffering as Row} />
                  </div>
                </div>
              </div>
              <Table headers={["Day", "Start", "End", "Room"]}>
                {((v.items as Row[]) ?? []).map((it, i) => (
                  <tr key={i}><td className="px-4 py-2">{DAYS[Number(it.weekday)]}</td><td className="px-4 py-2">{str(it.startTime)}</td><td className="px-4 py-2">{str(it.endTime)}</td><td className="px-4 py-2">{str(it.room || it.lab || "—")}</td></tr>
                ))}
              </Table>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialog} title="New schedule version (closes current)" onClose={() => setDialog(false)} wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label required>Course offering</Label><SearchableSelect options={offerings} value={offeringId} onChange={setOfferingId} clearLabel="Select..." /></div>
            <div><Label required>Effective from</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-5 items-end gap-2">
              <div className="col-span-1"><Label>Day</Label><Select value={str(it.weekday)} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, weekday: Number(e.target.value) } : x))}>{DAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}</Select></div>
              <div><Label>Start</Label><Input type="time" value={str(it.startTime)} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, startTime: e.target.value } : x))} /></div>
              <div><Label>End</Label><Input type="time" value={str(it.endTime)} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, endTime: e.target.value } : x))} /></div>
              <div><Label>Room</Label><Input value={str(it.room)} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, room: e.target.value } : x))} /></div>
              <Button variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={16} /></Button>
            </div>
          ))}
          <Button variant="outline" onClick={() => setItems([...items, { weekday: 1, startTime: "09:00", endTime: "10:00", room: "" }])}><Plus size={14} /> Add slot</Button>
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
