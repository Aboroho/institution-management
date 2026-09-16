"use client";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { accountApi, ApiError, authApi } from "@/lib/api/client";
import { validationDetails } from "@/lib/validation/form-errors";
import { Badge, Button, Card, ErrorState, FieldError, Input, Label, LoadingSkeleton, Spinner } from "@/components/ui";
import { KeyRound, Lock, Mail, ShieldCheck, User } from "lucide-react";

// Client-side mirrors of src/lib/validation/users.ts — UX only; the API re-validates everything.
const NAME_MIN = 2;
const NAME_MAX = 80;
const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  isSeedAdmin?: boolean;
}

/** The shell header reads the same "me" key, so revalidating it refreshes the name app-wide. */
export function useMe() {
  return useSWR<Me>("me", () => authApi.me().then((r) => r.data as Me));
}

function SuccessBanner({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{children}</p>;
}

export function ProtectedAccountNotice() {
  return (
    <Card className="mb-4 border-violet-200 bg-violet-50 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-violet-100 p-2 text-violet-700"><ShieldCheck size={18} /></span>
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-violet-900">Protected system account <Badge tone="violet">Seed admin</Badge></p>
          <p className="mt-1 text-sm text-violet-800">
            This administrator was created by the deployment&apos;s seed configuration and is protected by the system.
            Its name, email and password cannot be changed from the application, and the account cannot be deleted or lose its role.
            Operators change these via the <code className="rounded bg-violet-100 px-1">SEED_ADMIN_*</code> environment variables and the seed script.
          </p>
        </div>
      </div>
    </Card>
  );
}

function NameCard({ me, locked }: { me: Me; locked: boolean }) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => { setName(me.name); setSuccess(""); }, [me.name]);

  const trimmed = name.trim();
  const dirty = trimmed !== me.name;

  async function save() {
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setFieldErrors({ name: [`Name must be between ${NAME_MIN} and ${NAME_MAX} characters.`] });
      return;
    }
    if (!dirty) return;
    setSaving(true); setFormError(""); setFieldErrors({}); setSuccess("");
    try {
      await accountApi.updateProfile({ name: trimmed });
      await mutate("me");
      setSuccess("Name updated. It is shown across the application.");
    } catch (e) {
      if (e instanceof ApiError) {
        const { fieldErrors: server } = validationDetails(e.details);
        if (server.name) setFieldErrors({ name: server.name });
        else setFormError(e.message);
      } else setFormError("Could not save your name. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900"><User size={16} className="text-brand-600" /> Name</h2>
      <p className="mb-3 text-sm text-slate-500">Your display name, shown in the header and portal pages.</p>
      <Label htmlFor="profile-name" required>Full name</Label>
      <Input id="profile-name" value={name} disabled={locked || saving} aria-invalid={!!fieldErrors.name}
        onChange={(e) => { setName(e.target.value); setFieldErrors({}); setSuccess(""); }} />
      <p className="mt-1 text-xs text-slate-400">{locked ? "Managed by the system for protected accounts." : `${NAME_MIN}–${NAME_MAX} characters.`}</p>
      <FieldError error={fieldErrors.name?.[0]} />
      {success && <SuccessBanner>{success}</SuccessBanner>}
      <FieldError error={formError} />
      {!locked && (
        <div className="mt-3">
          <Button onClick={save} disabled={saving || !dirty}>{saving && <Spinner />} Save name</Button>
        </div>
      )}
    </Card>
  );
}

function EmailCard({ me, locked }: { me: Me; locked: boolean }) {
  const { mutate } = useSWRConfig();
  const [email, setEmail] = useState(me.email);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => { setEmail(me.email); setSuccess(""); }, [me.email]);

  const normalized = email.trim().toLowerCase();
  const dirty = normalized !== me.email.toLowerCase();

  async function save() {
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: ["Enter a valid email address, such as name@example.com."] });
      return;
    }
    if (!dirty) return;
    setSaving(true); setFormError(""); setFieldErrors({}); setSuccess("");
    try {
      await accountApi.updateProfile({ email: normalized });
      await mutate("me");
      setSuccess("Email updated. Use the new address the next time you sign in — your user ID, history and role are unchanged.");
    } catch (e) {
      if (e instanceof ApiError) {
        const { fieldErrors: server } = validationDetails(e.details);
        if (server.email) setFieldErrors({ email: server.email });
        else setFormError(e.message);
      } else setFormError("Could not update your email. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900"><Mail size={16} className="text-brand-600" /> Email</h2>
      <p className="mb-3 text-sm text-slate-500">Your sign-in address. Stored lowercased; uniqueness is enforced by the database.</p>
      <Label htmlFor="profile-email" required>Email</Label>
      <Input id="profile-email" type="email" autoComplete="email" value={email} disabled={locked || saving} aria-invalid={!!fieldErrors.email}
        onChange={(e) => { setEmail(e.target.value); setFieldErrors({}); setSuccess(""); }} />
      {locked ? (
        <p className="mt-1 text-xs text-slate-400">Managed by the system for protected accounts.</p>
      ) : dirty ? (
        <p className="mt-1 text-xs text-amber-600">You will sign in with <span className="font-medium">{normalized}</span> after saving.</p>
      ) : null}
      <FieldError error={fieldErrors.email?.[0]} />
      {success && <SuccessBanner>{success}</SuccessBanner>}
      <FieldError error={formError} />
      {!locked && (
        <div className="mt-3">
          <Button onClick={save} disabled={saving || !dirty}>{saving && <Spinner />} Save email</Button>
        </div>
      )}
    </Card>
  );
}

function PasswordCard({ locked }: { locked: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState("");

  function update(k: "current" | "next" | "confirm", v: string) {
    if (k === "current") setCurrent(v);
    else if (k === "next") setNext(v);
    else setConfirm(v);
    setFieldErrors((prev) => {
      const n = { ...prev };
      delete n[k === "current" ? "currentPassword" : k === "next" ? "newPassword" : "confirmPassword"];
      return n;
    });
    setFormError("");
    setSuccess("");
  }

  async function save() {
    const errs: Record<string, string[]> = {};
    if (!current) errs.currentPassword = ["Enter your current password."];
    if (next.length < PASSWORD_MIN) errs.newPassword = [`Password must be at least ${PASSWORD_MIN} characters.`];
    if (next && confirm !== next) errs.confirmPassword = ["Passwords do not match."];
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setFormError(""); setSuccess("");
    try {
      await accountApi.changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm });
      setCurrent(""); setNext(""); setConfirm("");
      setSuccess("Password changed. All other sessions were signed out; this device stays signed in.");
    } catch (e) {
      if (e instanceof ApiError) {
        const { fieldErrors: server } = validationDetails(e.details);
        const mapped: Record<string, string[]> = {};
        for (const k of ["currentPassword", "newPassword", "confirmPassword"] as const) if (server[k]) mapped[k] = server[k];
        if (Object.keys(mapped).length) setFieldErrors(mapped);
        else setFormError(e.message);
      } else setFormError("Could not change your password. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900"><KeyRound size={16} className="text-brand-600" /> Password</h2>
      <p className="mb-3 text-sm text-slate-500">Passwords are hashed with bcrypt and never shown or logged. Changing it signs out every other session.</p>
      <div className="space-y-3">
        <div>
          <Label htmlFor="pw-current" required>Current password</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} disabled={locked || saving}
            aria-invalid={!!fieldErrors.currentPassword} onChange={(e) => update("current", e.target.value)} />
          <FieldError error={fieldErrors.currentPassword?.[0]} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pw-new" required>New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} disabled={locked || saving}
              aria-invalid={!!fieldErrors.newPassword} onChange={(e) => update("next", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pw-confirm" required>Confirm new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} disabled={locked || saving}
              aria-invalid={!!fieldErrors.confirmPassword} onChange={(e) => update("confirm", e.target.value)} />
          </div>
        </div>
        <FieldError error={fieldErrors.newPassword?.[0]} />
        <FieldError error={fieldErrors.confirmPassword?.[0]} />
      </div>
      {locked ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
          <Lock size={14} /> Password changes for this account are managed by the system, not the application.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-400">At least {PASSWORD_MIN} characters.</p>
          {success && <SuccessBanner>{success}</SuccessBanner>}
          <FieldError error={formError} />
          <div className="mt-3">
            <Button onClick={save} disabled={saving || !current || !next || !confirm}>{saving && <Spinner />} Change password</Button>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Profile / account settings for Student, Teacher and Admin users.
 * All rules are enforced by the backend; disabled controls only communicate that.
 */
export function AccountSettings() {
  const { data: me, error, isLoading, mutate } = useMe();

  if (isLoading) return <LoadingSkeleton rows={4} />;
  if (error || !me) return <ErrorState message="Failed to load your profile" onRetry={() => mutate()} />;

  const locked = me.isSeedAdmin === true;
  return (
    <div className="space-y-4">
      {locked && <ProtectedAccountNotice />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NameCard me={me} locked={locked} />
        <EmailCard me={me} locked={locked} />
      </div>
      <div className="max-w-2xl">
        <PasswordCard locked={locked} />
      </div>
    </div>
  );
}
