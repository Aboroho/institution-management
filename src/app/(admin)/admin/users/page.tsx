"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { adminUsersApi, ApiError, qs } from "@/lib/api/client";
import type { AdminRow } from "@/lib/api/client";
import { validationDetails } from "@/lib/validation/form-errors";
import {
  Badge, Breadcrumbs, Button, Card, Dialog, EmptyState, ErrorState, FieldError, Input,
  Label, LoadingSkeleton, PageHeader, Pagination, Spinner, Table,
} from "@/components/ui";
import { Lock, Plus, Search, Shield, ShieldCheck, Trash2 } from "lucide-react";

const NAME_MIN = 2;
const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 25;

function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = qs({ adminsOnly: "true", page, limit: PAGE_SIZE, search: search || undefined });
  const { data, error, isLoading, mutate } = useSWR(`users${query}`, () => adminUsersApi.list({ page, limit: PAGE_SIZE, search: search || undefined }));
  const items: AdminRow[] = data?.data ?? [];
  const total: number = Number(data?.meta?.total ?? items.length);

  // ----- create dialog -----
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({});
  const createBodyRef = useRef<HTMLDivElement>(null);
  const [createFocusAttempt, setCreateFocusAttempt] = useState(0);

  useEffect(() => {
    if (createFocusAttempt) createBodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [createFocusAttempt]);

  function updateField(name: string, value: string) {
    setForm((p) => ({ ...p, [name]: value }));
    setCreateFieldErrors((p) => { const n = { ...p }; delete n[name]; return n; });
    setCreateError("");
  }

  async function createAdmin() {
    const errs: Record<string, string[]> = {};
    if ((form.name ?? "").trim().length < NAME_MIN) errs.name = [`Name must be at least ${NAME_MIN} characters.`];
    if (!EMAIL_RE.test((form.email ?? "").trim())) errs.email = ["Enter a valid email address, such as admin@institution.edu."];
    if ((form.password ?? "").length < PASSWORD_MIN) errs.password = [`Password must be at least ${PASSWORD_MIN} characters.`];
    if ((form.confirm ?? "") !== (form.password ?? "")) errs.confirm = ["Passwords do not match."];
    setCreateFieldErrors(errs);
    if (Object.keys(errs).length) { setCreateFocusAttempt((n) => n + 1); return; }
    setCreating(true);
    setCreateError("");
    try {
      await adminUsersApi.create({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      setCreateOpen(false);
      setForm({});
      setNotice(`Admin ${form.email.trim().toLowerCase()} created. They have normal admin access and can sign in with the initial password.`);
      await mutate();
    } catch (e) {
      if (e instanceof ApiError) {
        const { fieldErrors: server } = validationDetails(e.details);
        setCreateFieldErrors(server);
        setCreateError(e.message);
        if (Object.keys(server).length) setCreateFocusAttempt((n) => n + 1);
      } else setCreateError("Could not create the admin. Please try again.");
    } finally { setCreating(false); }
  }

  // ----- delete confirmation (requires typing the exact email — prevents accidental deletion) -----
  const [deleteTarget, setDeleteTarget] = useState<AdminRow | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function openDelete(row: AdminRow) {
    setDeleteTarget(row);
    setConfirmText("");
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!deleteTarget || confirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const email = deleteTarget.email;
      await adminUsersApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      setNotice(`Admin ${email} deleted. Their audit and academic history was preserved by the database.`);
      await mutate();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : "Could not delete the admin. The request was rejected.");
    } finally { setDeleting(false); }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Admins" }]} />
      <PageHeader
        title="Admin management"
        subtitle="Administrator accounts. The seed admin is a protected system account and cannot be modified or deleted from the application."
        actions={<Button onClick={() => { setCreateOpen(true); setCreateError(""); setCreateFieldErrors({}); setNotice(""); }}><Plus size={16} /> New admin</Button>}
      />

      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      <div className="mb-3 max-w-md">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search admins by name or email…" className="pl-9" aria-label="Search admins" />
        </div>
      </div>

      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState message="Failed to load admin accounts" onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={search ? "No admins match your search" : "No admin accounts"}
          hint={search ? "Try a different name or email." : "Create an administrator to grant application-wide admin access."}
          action={<Button onClick={() => setCreateOpen(true)}><Plus size={16} /> New admin</Button>}
        />
      ) : (
        <>
          <Table headers={["Account", "Email", "Status", "Protection", "Created", "Actions"]}>
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  <span className="flex items-center gap-2">{r.name}{r.isSeedAdmin && <ShieldCheck size={15} className="text-violet-600" aria-label="Protected system account" />}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">{r.email}</td>
                <td className="px-4 py-3">{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="px-4 py-3">
                  {r.isSeedAdmin
                    ? <Badge tone="violet">Protected · system-managed</Badge>
                    : <span className="text-xs text-slate-400">Normal admin</span>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-3">
                  {r.isSeedAdmin ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400" title="The seed admin cannot be edited or deleted from the application"><Lock size={13} /> No app controls</span>
                  ) : (
                    <Button variant="ghost" className="!px-2 !py-1 text-red-600 hover:bg-red-50" onClick={() => openDelete(r)} aria-label={`Delete admin ${r.email}`}>
                      <Trash2 size={14} /> <span className="hidden sm:inline">Delete</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      <Dialog open={createOpen} title="New administrator" onClose={() => { if (!creating) setCreateOpen(false); }}>
        <div className="space-y-3" ref={createBodyRef}>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            The account receives the normal application-wide <span className="font-semibold">ADMIN</span> role. It is <span className="font-semibold">not</span> a protected seed admin: unlike the seed account, normal admins can be managed and deleted.
          </p>
          <div>
            <Label htmlFor="adm-name" required>Name</Label>
            <Input id="adm-name" value={form.name ?? ""} onChange={(e) => updateField("name", e.target.value)} aria-invalid={!!createFieldErrors.name} placeholder="Full name" />
            <FieldError error={createFieldErrors.name?.[0]} />
          </div>
          <div>
            <Label htmlFor="adm-email" required>Email</Label>
            <Input id="adm-email" type="email" value={form.email ?? ""} onChange={(e) => updateField("email", e.target.value)} aria-invalid={!!createFieldErrors.email} placeholder="admin@institution.edu" autoComplete="off" />
            <FieldError error={createFieldErrors.email?.[0]} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="adm-password" required>Initial password</Label>
              <Input id="adm-password" type="password" value={form.password ?? ""} onChange={(e) => updateField("password", e.target.value)} aria-invalid={!!createFieldErrors.password} autoComplete="new-password" />
              <p className="mt-1 text-xs text-slate-400">At least {PASSWORD_MIN} characters.</p>
              <FieldError error={createFieldErrors.password?.[0]} />
            </div>
            <div>
              <Label htmlFor="adm-confirm" required>Confirm password</Label>
              <Input id="adm-confirm" type="password" value={form.confirm ?? ""} onChange={(e) => updateField("confirm", e.target.value)} aria-invalid={!!createFieldErrors.confirm} autoComplete="new-password" />
              <FieldError error={createFieldErrors.confirm?.[0]} />
            </div>
          </div>
          {createError && <FieldError error={createError} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createAdmin} disabled={creating}>{creating && <Spinner />} Create admin</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!deleteTarget} title="Delete administrator?" onClose={() => { if (!deleting) setDeleteTarget(null); }}>
        {deleteTarget && (
          <div className="space-y-3">
            <Card className="border-red-200 bg-red-50 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-red-800"><Shield size={15} /> Permanent and irreversible</p>
              <p className="mt-1 text-sm text-red-700">
                The account <span className="font-semibold">{deleteTarget.name}</span> ({deleteTarget.email}) will be deleted and can no longer sign in or call admin APIs.
                Audit history is preserved by the database (actor references are detached, never destroyed). Accounts with historical records cannot be deleted.
              </p>
            </Card>
            <div>
              <Label htmlFor="adm-delete-confirm" required>Type the email to confirm</Label>
              <Input id="adm-delete-confirm" value={confirmText} onChange={(e) => { setConfirmText(e.target.value); setDeleteError(""); }} placeholder={deleteTarget.email} autoComplete="off" />
              <FieldError error={deleteError} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={deleting || confirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()}
              >
                {deleting && <Spinner />} Delete admin
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
