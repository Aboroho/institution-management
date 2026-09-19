"use client";

/**
 * Notice composer.
 *
 * Recipients used to arrive as one giant payload containing every student and
 * every course offering the author could reach, all rendered at once. They are
 * now searched through the API one page at a time (`SearchableMultiSelect`), so
 * the dialog stays usable with thousands of records.
 *
 * Authorization is unchanged and still lives on the server: the composer only
 * renders what `/notices/recipients` returned for this account, and the write
 * endpoints re-validate every id before anything is saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, get, patchForm, post, postForm, qs } from "@/lib/api/client";
import { buildNoticePayload, type NoticeTargetKind } from "@/lib/notices/composer-payload";
import {
  Button,
  Dialog,
  FormSkeleton,
  Input,
  Label,
  StatusMessage,
  Textarea,
  Tooltip,
  cn,
} from "@/components/ui";
import { SearchableMultiSelect, type MultiSelectOption, type MultiSelectPage } from "@/components/searchable-multi-select";
import { Paperclip, Upload, Users, X } from "lucide-react";
import useSWR from "swr";

export type NoticeComposerRole = "ADMIN" | "TEACHER";
export type { NoticeTargetKind };

type RecipientKind = "COURSE_OFFERING" | "TEACHER" | "STUDENT";

interface RecipientPermissions {
  canTargetEveryone: boolean;
  canTargetAdmins: boolean;
  canTargetTeachers: boolean;
  counts: { offerings: number; students: number; teachers: number };
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

interface NoticeComposerProps {
  open: boolean;
  role: NoticeComposerRole;
  initial?: NoticeComposerInitial | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "docx", "xlsx", "pptx", "txt", "csv"];
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const RECIPIENT_TOOLTIPS: Record<RecipientKind, string> = {
  COURSE_OFFERING: "Reaches every active student enrolled in the selected class, now and after a teacher substitution.",
  TEACHER: "Reaches the selected teachers directly, regardless of the classes they teach.",
  STUDENT: "Reaches only the students you pick — use a course offering to reach a whole class.",
};

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function NoticeComposer({ open, role, initial, onClose, onSaved }: NoticeComposerProps) {
  const isEdit = Boolean(initial?.id);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [groupTarget, setGroupTarget] = useState<"EVERYONE" | "ADMINS" | null>(null);
  const [offerings, setOfferings] = useState<MultiSelectOption[]>([]);
  const [teachers, setTeachers] = useState<MultiSelectOption[]>([]);
  const [students, setStudents] = useState<MultiSelectOption[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fileNotice, setFileNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydratedFor = useRef<string | null>(null);

  const { data: permissions, error: permissionError, isLoading: permissionsLoading, mutate: retryPermissions } = useSWR<RecipientPermissions>(
    open ? "notice-recipient-permissions" : null,
    () => get<RecipientPermissions>("/notices/recipients").then((response) => response.data),
  );

  // Reset the draft whenever the dialog opens for a (different) notice.
  useEffect(() => {
    if (!open) { hydratedFor.current = null; return; }
    const key = initial?.id ?? "new";
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;
    setTitle(initial?.title ?? "");
    setContent(initial?.content ?? "");
    setExpiresAt(initial?.expiresAt ? initial.expiresAt.slice(0, 10) : "");
    setNewFiles([]);
    setRemovedAttachmentIds([]);
    setError("");
    setFileNotice("");
    setDragging(false);

    const targets = initial?.targets ?? [];
    const group = targets.find((target) => target.targetType === "EVERYONE" || target.targetType === "ADMINS");
    setGroupTarget(group ? (group.targetType as "EVERYONE" | "ADMINS") : null);
    const pick = (kind: RecipientKind) =>
      targets.filter((target) => target.targetType === kind).map((target) => ({ id: target.targetId, label: target.targetId }));
    setOfferings(pick("COURSE_OFFERING"));
    setTeachers(pick("TEACHER"));
    setStudents(pick("STUDENT"));

    // Stored targets are ids; ask the API for their human labels so the chips
    // read "CS-101 — Programming" instead of a cuid.
    const idTargets = targets.filter((target) => target.targetType !== "EVERYONE" && target.targetType !== "ADMINS");
    if (idTargets.length > 0) {
      void post<{ targetType: string; targetId: string; label: string }[]>("/notices/recipients", { targets: idTargets })
        .then((response) => {
          const labels = new Map(response.data.map((item) => [`${item.targetType}:${item.targetId}`, item.label]));
          const relabel = (kind: RecipientKind) => (current: MultiSelectOption[]) =>
            current.map((option) => ({ ...option, label: labels.get(`${kind}:${option.id}`) ?? option.label }));
          setOfferings(relabel("COURSE_OFFERING"));
          setTeachers(relabel("TEACHER"));
          setStudents(relabel("STUDENT"));
        })
        .catch(() => { /* Labels are cosmetic; the ids are already correct. */ });
    }
  }, [open, initial]);

  const makeLoader = useCallback(
    (kind: RecipientKind) =>
      async ({ query, page, signal }: { query: string; page: number; signal: AbortSignal }): Promise<MultiSelectPage> => {
        const response = await get<MultiSelectOption[]>(
          `/notices/recipients${qs({ kind, search: query || undefined, page, limit: 25 })}`,
          { signal },
        );
        const meta = response.meta as { total?: number; page?: number; limit?: number } | undefined;
        const total = Number(meta?.total ?? response.data.length);
        const limit = Number(meta?.limit ?? 25);
        return { options: response.data, hasMore: page * limit < total };
      },
    [],
  );

  const loadOfferings = useMemo(() => makeLoader("COURSE_OFFERING"), [makeLoader]);
  const loadTeachers = useMemo(() => makeLoader("TEACHER"), [makeLoader]);
  const loadStudents = useMemo(() => makeLoader("STUDENT"), [makeLoader]);

  function chooseGroup(type: "EVERYONE" | "ADMINS") {
    // "Everyone" is exclusive per the API contract; picking it clears the rest.
    if (groupTarget === type) { setGroupTarget(null); return; }
    setGroupTarget(type);
    setOfferings([]); setTeachers([]); setStudents([]);
    setError("");
  }

  function clearGroup() { setGroupTarget(null); }

  function addFiles(files: File[]) {
    setFileNotice("");
    const currentCount = (initial?.attachments?.length ?? 0) - removedAttachmentIds.length + newFiles.length;
    if (currentCount + files.length > MAX_FILES) {
      setFileNotice(`A notice can have at most ${MAX_FILES} attachments.`);
      return;
    }
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} is larger than 25 MB`); continue; }
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) { rejected.push(`${file.name} has an unsupported file type`); continue; }
      if (!newFiles.some((existing) => existing.name === file.name && existing.size === file.size)) accepted.push(file);
    }
    if (rejected.length) setFileNotice(rejected.join(" · "));
    setNewFiles((current) => [...current, ...accepted]);
  }

  const selectionCount = groupTarget ? 1 : offerings.length + teachers.length + students.length;

  function payloadTargets(): { type: NoticeTargetKind; ids: string[] }[] {
    if (groupTarget) return [{ type: groupTarget, ids: [] }];
    const targets: { type: NoticeTargetKind; ids: string[] }[] = [];
    if (offerings.length) targets.push({ type: "COURSE_OFFERING", ids: offerings.map((option) => option.id) });
    if (teachers.length) targets.push({ type: "TEACHER", ids: teachers.map((option) => option.id) });
    if (students.length) targets.push({ type: "STUDENT", ids: students.map((option) => option.id) });
    return targets;
  }

  async function save() {
    if (saving) return;
    setError("");
    if (!title.trim()) { setError("Add a title before publishing."); return; }
    if (!content.trim()) { setError("Add the notice message before publishing."); return; }
    if (selectionCount === 0) { setError("Choose at least one recipient."); return; }
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
      // The draft is intentionally left intact so nothing typed is lost.
      setError(caught instanceof ApiError ? caught.message : "Unable to save the notice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const activeAttachments = (initial?.attachments ?? []).filter((attachment) => !removedAttachmentIds.includes(attachment.id));
  const uploading = saving && newFiles.length > 0;

  return (
    <Dialog
      open={open}
      size="lg"
      title={isEdit ? "Edit notice" : "New notice"}
      description={isEdit ? "Changes reach the same audience unless you change it." : undefined}
      onClose={() => { if (!saving) onClose(); }}
    >
      <div className="space-y-5">
        <div>
          <Label required htmlFor="notice-title">Title</Label>
          <Input id="notice-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Midterm examination schedule" disabled={saving} />
        </div>
        <div>
          <Label required htmlFor="notice-content">Message</Label>
          <Textarea id="notice-content" rows={7} maxLength={100000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write the complete notice here..." disabled={saving} />
        </div>
        <div className="max-w-xs">
          <div className="mb-1 flex items-center gap-1.5">
            <Label htmlFor="notice-expiry">Expires at</Label>
            <Tooltip content="After this date the notice stops appearing for recipients. Leave empty to keep it indefinitely.">
              <button type="button" className="-mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-500 hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <span aria-hidden="true">?</span><span className="sr-only">About the expiry date</span>
              </button>
            </Tooltip>
          </div>
          <Input id="notice-expiry" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={saving} />
        </div>

        <section aria-labelledby="notice-recipient-heading" className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="notice-recipient-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users size={15} aria-hidden="true" className="text-slate-400" /> Recipients
            </h3>
            <span className={cn("text-xs font-medium", selectionCount > 0 ? "text-brand-700" : "text-slate-500")} aria-live="polite">
              {selectionCount === 0 ? "None selected" : groupTarget ? (groupTarget === "EVERYONE" ? "Everyone in the system" : "All active admins") : `${selectionCount} selected`}
            </span>
          </div>

          {permissionError ? (
            <StatusMessage tone="error" className="mb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Recipient options could not be loaded.</span>
                <Button size="sm" variant="outline" onClick={() => void retryPermissions()} disabled={saving}>Retry</Button>
              </div>
            </StatusMessage>
          ) : permissionsLoading || !permissions ? (
            <FormSkeleton fields={2} />
          ) : (
            <>
              {(permissions.canTargetEveryone || permissions.canTargetAdmins) && (
                <div className="flex flex-wrap gap-2">
                  {permissions.canTargetEveryone && (
                    <Tooltip content="Sends to every active account in the institution. Cannot be combined with other recipients.">
                      <Button type="button" size="sm" variant={groupTarget === "EVERYONE" ? "primary" : "outline"} onClick={() => chooseGroup("EVERYONE")} disabled={saving} aria-pressed={groupTarget === "EVERYONE"}>
                        Everyone
                      </Button>
                    </Tooltip>
                  )}
                  {permissions.canTargetAdmins && (
                    <Tooltip content="Sends to all active administrators — the usual way to escalate something to the office.">
                      <Button type="button" size="sm" variant={groupTarget === "ADMINS" ? "primary" : "outline"} onClick={() => chooseGroup("ADMINS")} disabled={saving} aria-pressed={groupTarget === "ADMINS"}>
                        All admins
                      </Button>
                    </Tooltip>
                  )}
                </div>
              )}

              {groupTarget ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-brand-900">
                  <span>{groupTarget === "EVERYONE" ? "This notice goes to everyone in the system." : "This notice goes to all active admins."}</span>
                  <Button size="sm" variant="ghost" onClick={clearGroup} disabled={saving}>Choose specific recipients</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SearchableMultiSelect
                    label="Course offerings"
                    tooltip={RECIPIENT_TOOLTIPS.COURSE_OFFERING}
                    selected={offerings}
                    onChange={setOfferings}
                    loadPage={loadOfferings}
                    disabled={saving}
                    allowSelectAllLoaded
                    emptyMessage={permissions.counts.offerings === 0 ? "No course offerings are available to you" : "No matching offerings"}
                  />
                  {permissions.canTargetTeachers && (
                    <SearchableMultiSelect
                      label="Teachers"
                      tooltip={RECIPIENT_TOOLTIPS.TEACHER}
                      selected={teachers}
                      onChange={setTeachers}
                      loadPage={loadTeachers}
                      disabled={saving}
                      emptyMessage={permissions.counts.teachers === 0 ? "No active teachers" : "No matching teachers"}
                    />
                  )}
                  <SearchableMultiSelect
                    label="Students"
                    tooltip={RECIPIENT_TOOLTIPS.STUDENT}
                    selected={students}
                    onChange={setStudents}
                    loadPage={loadStudents}
                    disabled={saving}
                    emptyMessage={permissions.counts.students === 0 ? "No students are available to you" : "No matching students"}
                  />
                </div>
              )}
              {role === "TEACHER" && !groupTarget && (
                <p className="text-xs text-slate-500">You can only reach admins, your assigned offerings and their students.</p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="notice-attachments-heading" className="border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="notice-attachments-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Paperclip size={15} aria-hidden="true" className="text-slate-400" /> Attachments
            </h3>
            <span className="text-xs text-slate-500">Max {MAX_FILES} files · 25 MB each</span>
          </div>

          {activeAttachments.length > 0 && (
            <ul className="mt-3 space-y-2">
              {activeAttachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{attachment.file.originalName} <span className="text-xs text-slate-500">({fileSize(attachment.file.size)})</span></span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRemovedAttachmentIds((ids) => [...ids, attachment.id])} disabled={saving}>Remove</Button>
                </li>
              ))}
            </ul>
          )}

          <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
            className={cn("mt-3 rounded-xl border-2 border-dashed p-4 text-center transition", dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50")}
          >
            <Upload size={20} aria-hidden="true" className="mx-auto text-slate-400" />
            <p className="mt-1.5 text-sm text-slate-600">Drop files here or</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => inputRef.current?.click()} disabled={saving}>Choose files</Button>
            <input ref={inputRef} type="file" multiple className="hidden" aria-label="Choose attachment files" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
          </div>

          {fileNotice && <StatusMessage tone="warning" className="mb-0 mt-3" onDismiss={() => setFileNotice("")}>{fileNotice}</StatusMessage>}

          {newFiles.length > 0 && (
            <ul className="mt-3 space-y-2">
              {newFiles.map((file, index) => (
                <li key={`${file.name}:${file.size}:${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{file.name} <span className="text-xs text-slate-500">({fileSize(file.size)})</span></span>
                  {saving ? (
                    <span className="shrink-0 text-xs font-medium text-emerald-700">Uploading…</span>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={() => setNewFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                      <X size={13} aria-hidden="true" /> Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <StatusMessage tone="error" className="mb-0">{error}</StatusMessage>}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            type="button"
            onClick={() => void save()}
            loading={saving}
            loadingText={uploading ? "Uploading…" : isEdit ? "Saving…" : "Publishing…"}
            disabled={permissionsLoading || !permissions}
          >
            {isEdit ? "Save changes" : "Publish notice"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
