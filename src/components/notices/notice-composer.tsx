"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, get, patchForm, postForm } from "@/lib/api/client";
import { buildNoticePayload, type NoticeTargetKind } from "@/lib/notices/composer-payload";
import {
  Badge,
  Button,
  Dialog,
  FieldError,
  Input,
  Label,
  Spinner,
  Textarea,
  cn,
} from "@/components/ui";
import { Paperclip, Search, Upload, X } from "lucide-react";
import useSWR from "swr";

export type NoticeComposerRole = "ADMIN" | "TEACHER";
export type { NoticeTargetKind };

interface PersonOption {
  id: string;
  user: { name: string; email: string };
  studentId?: string;
  employeeId?: string;
}

interface OfferingOption {
  id: string;
  course: { title: string; code: string };
  academicYear: { name: string };
  trade: { name: string; code: string };
  semester: { name: string; number: number };
  shift: { name: string };
  section: { name: string };
}

interface RecipientOptions {
  canTargetEveryone: boolean;
  canTargetAdmins: boolean;
  offerings: OfferingOption[];
  teachers: PersonOption[];
  students: PersonOption[];
}

export interface NoticeAttachmentSummary {
  id: string;
  file: { id: string; originalName: string; mimeType: string; size: number };
}

export interface NoticeComposerInitial {
  id?: string;
  version?: number;
  title?: string;
  content?: string;
  expiresAt?: string | null;
  targets?: { targetType: NoticeTargetKind; targetId: string }[];
  attachments?: NoticeAttachmentSummary[];
}

interface Selection {
  type: NoticeTargetKind;
  id: string;
  label: string;
}

interface NoticeComposerProps {
  open: boolean;
  role: NoticeComposerRole;
  initial?: NoticeComposerInitial | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface MultiPickerProps {
  label: string;
  options: { id: string; label: string; search: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyMessage: string;
}

function formatOffering(offering: OfferingOption): string {
  return `${offering.course.title} — ${offering.trade.code} · ${offering.semester.name} · ${offering.shift.name} · Sec ${offering.section.name} · ${offering.academicYear.name}`;
}

function formatPerson(person: PersonOption): string {
  const identifier = person.studentId ?? person.employeeId;
  return identifier ? `${identifier} — ${person.user.name}` : person.user.name;
}

function MultiPicker({ label, options, selected, onToggle, emptyMessage }: MultiPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? options.filter((option) => option.search.includes(normalized)) : options;
  }, [options, query]);

  return (
    <div>
      <Label>{label}</Label>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search size={14} className="text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            aria-label={`Search ${label}`}
            className="w-full py-2 text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <div className="max-h-44 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">{emptyMessage}</p>
          ) : filtered.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={checked} onChange={() => onToggle(option.id)} className="mt-0.5 accent-brand-600" />
                <span className={cn("leading-5", checked && "font-medium text-brand-700")}>{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      {selected.length > 0 && <p className="mt-1 text-xs text-slate-500">{selected.length} selected</p>}
    </div>
  );
}

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function initialSelections(initial: NoticeComposerInitial | null | undefined): Selection[] {
  return (initial?.targets ?? []).map((target) => ({
    type: target.targetType,
    id: target.targetId,
    label: target.targetType === "EVERYONE" ? "Everyone in the system" : target.targetType === "ADMINS" ? "All active admins" : target.targetId,
  }));
}

export function NoticeComposer({ open, role, initial, onClose, onSaved }: NoticeComposerProps) {
  const isEdit = Boolean(initial?.id);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: recipientResponse, error: recipientError, isLoading: recipientsLoading, mutate: retryRecipients } = useSWR<{ data: RecipientOptions }>(
    open ? "notice-recipient-options" : null,
    () => get<RecipientOptions>("/notices/recipients").then((response) => response),
  );
  const options = recipientResponse?.data;

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setContent(initial?.content ?? "");
    setExpiresAt(initial?.expiresAt ? initial.expiresAt.slice(0, 10) : "");
    setSelections(initialSelections(initial));
    setNewFiles([]);
    setRemovedAttachmentIds([]);
    setError("");
    setDragging(false);
  }, [open, initial]);

  const offeringOptions = useMemo(() => (options?.offerings ?? []).map((offering) => ({
    id: offering.id,
    label: formatOffering(offering),
    search: `${formatOffering(offering)} ${offering.course.code}`.toLowerCase(),
  })), [options?.offerings]);
  const teacherOptions = useMemo(() => (options?.teachers ?? []).map((teacher) => ({
    id: teacher.id,
    label: formatPerson(teacher),
    search: `${formatPerson(teacher)} ${teacher.user.email}`.toLowerCase(),
  })), [options?.teachers]);
  const studentOptions = useMemo(() => (options?.students ?? []).map((student) => ({
    id: student.id,
    label: formatPerson(student),
    search: `${formatPerson(student)} ${student.user.email}`.toLowerCase(),
  })), [options?.students]);

  useEffect(() => {
    if (!open || !options) return;
    const labels = new Map<string, string>();
    for (const option of offeringOptions) labels.set(`COURSE_OFFERING:${option.id}`, option.label);
    for (const option of teacherOptions) labels.set(`TEACHER:${option.id}`, option.label);
    for (const option of studentOptions) labels.set(`STUDENT:${option.id}`, option.label);
    setSelections((current) => current.map((selection) => ({
      ...selection,
      label: labels.get(`${selection.type}:${selection.id}`) ?? selection.label,
    })));
  }, [open, options, offeringOptions, teacherOptions, studentOptions]);

  function selectedIds(type: NoticeTargetKind): string[] {
    return selections.filter((selection) => selection.type === type).map((selection) => selection.id);
  }

  function toggleGroup(type: "EVERYONE" | "ADMINS") {
    if (selections.some((selection) => selection.type === type)) {
      setSelections([]);
    } else {
      setSelections([{ type, id: "*", label: type === "EVERYONE" ? "Everyone in the system" : "All active admins" }]);
    }
  }

  function toggleOption(type: Exclude<NoticeTargetKind, "EVERYONE" | "ADMINS">, id: string, label: string) {
    setSelections((current) => {
      const withoutGroups = current.filter((selection) => selection.type !== "EVERYONE" && selection.type !== "ADMINS");
      const exists = withoutGroups.some((selection) => selection.type === type && selection.id === id);
      if (exists) return withoutGroups.filter((selection) => !(selection.type === type && selection.id === id));
      return [...withoutGroups, { type, id, label }];
    });
  }

  function removeSelection(selection: Selection) {
    setSelections((current) => current.filter((item) => !(item.type === selection.type && item.id === selection.id)));
  }

  function addFiles(files: File[]) {
    setError("");
    const currentCount = (initial?.attachments?.length ?? 0) - removedAttachmentIds.length + newFiles.length;
    if (currentCount + files.length > 10) {
      setError("A notice can have at most 10 attachments.");
      return;
    }
    const accepted: File[] = [];
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setError(`${file.name} is larger than 25 MB.`);
        continue;
      }
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !["pdf", "png", "jpg", "jpeg", "gif", "webp", "docx", "xlsx", "pptx", "txt", "csv"].includes(extension)) {
        setError(`${file.name} has an unsupported file type.`);
        continue;
      }
      if (!newFiles.some((existing) => existing.name === file.name && existing.size === file.size)) accepted.push(file);
    }
    setNewFiles((current) => [...current, ...accepted]);
  }

  function payloadTargets(): { type: NoticeTargetKind; ids: string[] }[] {
    const grouped = new Map<NoticeTargetKind, string[]>();
    for (const selection of selections) {
      if (selection.type === "EVERYONE" || selection.type === "ADMINS") {
        grouped.set(selection.type, []);
        continue;
      }
      const ids = grouped.get(selection.type) ?? [];
      ids.push(selection.id);
      grouped.set(selection.type, ids);
    }
    return [...grouped.entries()].map(([type, ids]) => ({ type, ids }));
  }

  async function save() {
    setError("");
    if (!title.trim()) { setError("Title is required."); return; }
    if (!content.trim()) { setError("Content is required."); return; }
    if (selections.length === 0) { setError("Select at least one recipient target."); return; }
    setSaving(true);
    try {
      const draft = { title, content, expiresAt, targets: payloadTargets() };
      const editingId = isEdit && initial?.id ? initial.id : null;
      // The API's create and update schemas are strict: only send `expectedVersion`
      // and `removeAttachmentIds` when editing an existing notice.
      const payload = buildNoticePayload(
        draft,
        editingId ? { version: initial?.version ?? 1, removeAttachmentIds: removedAttachmentIds } : null,
      );
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      for (const file of newFiles) form.append("files", file);
      if (editingId) await patchForm(`/notices/${editingId}`, form);
      else await postForm("/notices", form);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Unable to save the notice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const activeAttachments = (initial?.attachments ?? []).filter((attachment) => !removedAttachmentIds.includes(attachment.id));
  const busyRecipients = recipientsLoading || !options;

  return (
    <Dialog open={open} title={isEdit ? "Edit notice" : "New notice"} onClose={() => { if (!saving) onClose(); }} wide>
      <div className="space-y-5 overflow-y-auto px-5 py-5">
        <div>
          <Label required htmlFor="notice-title">Title</Label>
          <Input id="notice-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Midterm examination schedule" disabled={saving} />
        </div>
        <div>
          <Label required htmlFor="notice-content">Message</Label>
          <Textarea id="notice-content" rows={7} maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write the complete notice here..." disabled={saving} />
          <p className="mt-1 text-xs text-slate-500">Plain text is preserved with line breaks and safely rendered for recipients.</p>
        </div>
        <div>
          <Label htmlFor="notice-expiry">Expires at</Label>
          <Input id="notice-expiry" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={saving} />
        </div>

        <section aria-labelledby="notice-recipient-heading" className="space-y-3">
          <div>
            <h3 id="notice-recipient-heading" className="text-sm font-semibold text-slate-800">Recipients</h3>
            <p className="mt-1 text-xs text-slate-500">Only targets permitted by your role and current academic assignments are shown.</p>
          </div>
          {recipientError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p>Recipient options could not be loaded.</p>
              <Button className="mt-2" size="sm" variant="outline" onClick={() => retryRecipients()} disabled={saving}>Retry</Button>
            </div>
          ) : busyRecipients ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading permitted recipients...</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {options.canTargetEveryone && (
                  <Button type="button" size="sm" variant={selectedIds("EVERYONE").length ? "primary" : "outline"} onClick={() => toggleGroup("EVERYONE")} disabled={saving}>
                    Everyone
                  </Button>
                )}
                {options.canTargetAdmins && (
                  <Button type="button" size="sm" variant={selectedIds("ADMINS").length ? "primary" : "outline"} onClick={() => toggleGroup("ADMINS")} disabled={saving}>
                    All admins
                  </Button>
                )}
              </div>
              {!selectedIds("EVERYONE").length && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <MultiPicker label="Course offerings" options={offeringOptions} selected={selectedIds("COURSE_OFFERING")} onToggle={(id) => toggleOption("COURSE_OFFERING", id, offeringOptions.find((option) => option.id === id)?.label ?? id)} emptyMessage="No permitted course offerings" />
                  {role === "ADMIN" && <MultiPicker label="Teachers" options={teacherOptions} selected={selectedIds("TEACHER")} onToggle={(id) => toggleOption("TEACHER", id, teacherOptions.find((option) => option.id === id)?.label ?? id)} emptyMessage="No active teachers" />}
                  <MultiPicker label="Students" options={studentOptions} selected={selectedIds("STUDENT")} onToggle={(id) => toggleOption("STUDENT", id, studentOptions.find((option) => option.id === id)?.label ?? id)} emptyMessage="No permitted students" />
                </div>
              )}
              <div className="flex flex-wrap gap-2" aria-label="Selected recipients">
                {selections.length === 0 ? <p className="text-sm text-slate-500">No recipient targets selected.</p> : selections.map((selection) => (
                  <Badge key={`${selection.type}:${selection.id}`} tone="blue">
                    <span className="mr-1">{selection.label}</span>
                    <button type="button" aria-label={`Remove ${selection.label}`} onClick={() => removeSelection(selection)} disabled={saving} className="rounded-full hover:bg-blue-200"><X size={12} /></button>
                  </Badge>
                ))}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="notice-attachments-heading">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 id="notice-attachments-heading" className="text-sm font-semibold text-slate-800">Attachments</h3>
              <p className="mt-1 text-xs text-slate-500">Up to 10 files, 25 MB each. PDF, images, Office documents, TXT and CSV are supported.</p>
            </div>
            <Paperclip size={18} className="text-slate-400" />
          </div>
          {activeAttachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {activeAttachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{attachment.file.originalName} <span className="text-xs text-slate-500">({fileSize(attachment.file.size)})</span></span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRemovedAttachmentIds((ids) => [...ids, attachment.id])} disabled={saving}>Remove</Button>
                </div>
              ))}
            </div>
          )}
          <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
            className={cn("mt-3 rounded-xl border-2 border-dashed p-5 text-center transition", dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50")}
          >
            <Upload size={22} className="mx-auto text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700">Drop files here</p>
            <p className="mt-1 text-xs text-slate-500">or</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => inputRef.current?.click()} disabled={saving}>Choose files</Button>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
          </div>
          {newFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {newFiles.map((file, index) => (
                <div key={`${file.name}:${file.size}:${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{file.name} <span className="text-xs text-slate-500">({fileSize(file.size)})</span></span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setNewFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} disabled={saving}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <FieldError error={error} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={saving || busyRecipients}>{saving && <Spinner />}{saving ? "Uploading..." : isEdit ? "Save changes" : "Publish notice"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
