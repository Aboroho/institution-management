"use client";
import { useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ApiError, adminUsersApi, type AdminAccountSummary } from "@/lib/api/client";
import { validationDetails } from "@/lib/validation/form-errors";
import { createAdminAccountSchema } from "@/lib/validation/user";
import {
  Badge, Breadcrumbs, Button, Card, Dialog, EmptyState, ErrorState, FieldError, Input, Label,
  TableSkeleton, PageHeader, Pagination, PasswordInput, Table,
} from "@/components/ui";

type CreateAdminForm = z.infer<typeof createAdminAccountSchema>;
const CREATE_FIELDS = ["name", "email", "password"] as const;
const PROTECTED_SEED_ADMIN_BADGE = "Protected Seed Admin";

/**
 * Admin account management.
 *
 * The protected seed admin may create and delete normal admin accounts. Normal admins
 * see the same list (the API already allowed admins to list users) but no create/delete
 * controls — and the backend rejects those calls for them regardless of what this UI
 * renders. The protected seed admin row is labelled and can never be deleted.
 */
export default function AdminAccountsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;
  const { data, error, isLoading, mutate } = useSWR(
    ["admin/users", search, page],
    () => adminUsersApi.list({ search: search || undefined, page, limit }),
  );

  const admins = data?.data ?? [];
  const total = Number(data?.meta?.total ?? admins.length);
  // UX only: the API decides. `canManage` reflects the server-verified protected
  // seed admin, not a client-side flag.
  const canManage = data?.meta?.canManage === true;

  const [createOpen, setCreateOpen] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<AdminAccountSummary | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "error" | "info"; message: string } | null>(null);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Admin Accounts" }]} />
      <PageHeader
        title="Admin Accounts"
        subtitle="Institution administrators. Only the protected seed admin can create or remove admin accounts."
        actions={
          canManage ? (
            <Button onClick={() => { setBanner(null); setCreateOpen(true); }}>
              <Plus size={16} /> Create admin
            </Button>
          ) : undefined
        }
      />

      {!canManage && (
        <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600" role="status">
          You can view admin accounts, but only the protected seed admin can create or delete them.
        </p>
      )}
      {banner && (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className={`mb-4 rounded-lg p-3 text-sm ${
            banner.tone === "ok" ? "bg-emerald-50 text-emerald-700" : banner.tone === "info" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"
          }`}
        >
          {banner.message}
        </p>
      )}

      <Card className="mb-4 p-4">
        <div className="max-w-sm">
          <Label htmlFor="admin-search">Search</Label>
          <Input
            id="admin-search"
            type="search"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </Card>

      {isLoading ? (
        <TableSkeleton columns={5} rows={5} label="Loading admin accounts" />
      ) : error ? (
        <ErrorState message="We couldn't load admin accounts." onRetry={() => mutate()} />
      ) : admins.length === 0 ? (
        <EmptyState
          title="No admin accounts found"
          hint={search ? "Try a different search term." : "Create the first admin account."}
        />
      ) : (
        <Table headers={["Name", "Email", "Status", "Created", "Actions"]}>
          {admins.map((admin) => (
            <tr key={admin.id}>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{admin.name}</span>
                  {admin.isProtectedSeedAdmin && (
                    <Badge tone="violet">
                      <ShieldCheck size={13} aria-hidden /> {PROTECTED_SEED_ADMIN_BADGE}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-600">{admin.email}</td>
              <td className="px-4 py-3">
                <Badge tone={admin.isActive ? "green" : "slate"}>{admin.isActive ? "Active" : "Inactive"}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-500">{new Date(admin.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                {admin.isProtectedSeedAdmin ? (
                  <span className="text-xs text-slate-500">Protected — cannot be deleted</span>
                ) : canManage ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setBanner(null); setRemovalTarget(admin); }}
                    aria-label={`Delete admin account ${admin.name}`}
                  >
                    <Trash2 size={14} /> Delete
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {!isLoading && !error && total > limit && (
        <Pagination page={page} limit={limit} total={total} onPage={setPage} />
      )}

      <CreateAdminDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (created) => {
          setCreateOpen(false);
          setBanner({ tone: "ok", message: `Admin account created for ${created.name} (${created.email}).` });
          await mutate();
        }}
      />

      <DeleteAdminDialog
        target={removalTarget}
        onClose={() => setRemovalTarget(null)}
        onRemoved={async (result) => {
          setRemovalTarget(null);
          setBanner(
            result.mode === "deleted"
              ? { tone: "ok", message: `Admin account ${result.user.email} was deleted.` }
              : {
                  tone: "info",
                  message: `Access for ${result.user.email} was revoked and the account deactivated (history preserved: ${result.preservedHistory.join(", ")}).`,
                },
          );
          await mutate();
        }}
      />
    </div>
  );
}

function CreateAdminDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: AdminAccountSummary) => Promise<void>;
}) {
  const [formError, setFormError] = useState("");
  const {
    register, handleSubmit, reset, setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateAdminForm>({
    resolver: zodResolver(createAdminAccountSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: CreateAdminForm) {
    setFormError("");
    try {
      const { data: created } = await adminUsersApi.create(values);
      reset({ name: "", email: "", password: "" });
      await onCreated(created);
    } catch (e) {
      let focused = false;
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") {
        const { fieldErrors } = validationDetails(e.details);
        for (const field of CREATE_FIELDS) {
          const messages = fieldErrors[field];
          if (messages?.length) {
            setError(field, { type: "server", message: messages.join(" ") }, { shouldFocus: !focused });
            focused = true;
          }
        }
      }
      setFormError(e instanceof ApiError ? e.message : "Couldn't create the admin account.");
    }
  }

  return (
    <Dialog open={open} title="Create admin account" onClose={() => { if (!isSubmitting) onClose(); }}>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <Label htmlFor="admin-name" required>Name</Label>
          <Input
            id="admin-name"
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "admin-name-error" : undefined}
            {...register("name")}
          />
          <FieldError id="admin-name-error" error={errors.name?.message} />
        </div>
        <div>
          <Label htmlFor="admin-email" required>Email</Label>
          <Input
            id="admin-email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "admin-email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="admin-email-error" error={errors.email?.message} />
        </div>
        <div>
          <Label htmlFor="admin-password" required>Initial password</Label>
          <PasswordInput
            id="admin-password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "admin-password-error" : "admin-password-hint"}
            {...register("password")}
          />
          <FieldError id="admin-password-error" error={errors.password?.message} />
          <p id="admin-password-hint" className="mt-1 text-xs text-slate-500">
            At least 8 characters. Share it securely — the admin can change it after signing in.
          </p>
        </div>
        {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" loading={isSubmitting} loadingText="Creating…">
            Create admin
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteAdminDialog({
  target,
  onClose,
  onRemoved,
}: {
  target: AdminAccountSummary | null;
  onClose: () => void;
  onRemoved: (result: { mode: "deleted" | "deactivated"; user: { id: string; email: string; name: string }; preservedHistory: string[] }) => Promise<void>;
}) {
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setFormError("");
    try {
      const { data: result } = await adminUsersApi.remove(target.id);
      await onRemoved(result);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't remove the admin account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} title="Delete admin account" onClose={() => { if (!busy) onClose(); }}>
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Delete <span className="font-semibold">{target.name}</span> ({target.email})? The account loses
            access immediately and every signed-in session for it is revoked.
          </p>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            If the account has history (audit entries, marks, attendance, assignments), the record is
            deactivated instead of deleted so that history is preserved. This cannot be undone.
          </p>
          {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="button" variant="danger" onClick={() => void confirm()} loading={busy} loadingText="Deleting…">
              Delete account
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
