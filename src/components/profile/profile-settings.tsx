"use client";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock, ShieldCheck } from "lucide-react";
import { ApiError, profileApi } from "@/lib/api/client";
import { validationDetails } from "@/lib/validation/form-errors";
import { changeOwnPasswordSchema, updateOwnProfileSchema } from "@/lib/validation/user";
import {
  Badge, Breadcrumbs, Button, Card, ErrorState, FieldError, Input, Label,
  LoadingSkeleton, PageHeader, PasswordInput, Spinner,
} from "@/components/ui";

type ProfileForm = z.infer<typeof updateOwnProfileSchema>;
type PasswordForm = z.infer<typeof changeOwnPasswordSchema>;

const PROFILE_FIELDS = ["name", "email"] as const;
const PASSWORD_FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;

/**
 * Profile + password settings for the signed-in user (student, teacher or admin).
 *
 * The API is the security boundary: this page only mirrors the rules for a good
 * experience. Every request goes to `/users/me`, so there is no user id in the client
 * that could be pointed at somebody else, and the protected seed admin account gets a
 * read-only view because the backend rejects those changes anyway.
 */
export function ProfileSettings({ portal }: { portal: "admin" | "teacher" | "student" }) {
  const router = useRouter();
  const { data: profile, error, isLoading, mutate: refresh } = useSWR("users/me", () => profileApi.me().then((r) => r.data));

  if (isLoading) {
    return (
      <>
        <PageHeader title="My Profile" subtitle="Manage your account details and password." />
        <LoadingSkeleton rows={4} />
      </>
    );
  }
  if (error || !profile) {
    return (
      <>
        <PageHeader title="My Profile" subtitle="Manage your account details and password." />
        <ErrorState message="We couldn't load your profile." onRetry={() => refresh()} />
      </>
    );
  }

  const breadcrumbs = [
    { label: portal.charAt(0).toUpperCase() + portal.slice(1), href: `/${portal}/dashboard` },
    { label: "My Profile" },
  ];

  return (
    <div>
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="My Profile"
        subtitle="Manage your account details and password."
        actions={profile.isProtectedSeedAdmin ? <Badge tone="violet"><ShieldCheck size={14} /> Protected Seed Admin</Badge> : undefined}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {profile.isProtectedSeedAdmin ? (
          <ProtectedAccountCard name={profile.name} email={profile.email} />
        ) : (
          <ProfileCard profile={profile} onSaved={async () => { await refresh(); await globalMutate("me"); router.refresh(); }} />
        )}
        {profile.isProtectedSeedAdmin ? <ProtectedPasswordCard /> : <PasswordCard onChanged={async () => { await refresh(); await globalMutate("me"); }} />}
      </div>
    </div>
  );
}

function ProtectedAccountCard({ name, email }: { name: string; email: string }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Account details</h2>
      <p className="mb-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-800" role="status">
        This account is the protected seed admin created by the deployment seed configuration. Its name
        and email cannot be changed through the application.
      </p>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-slate-500">Name</dt>
          <dd className="font-medium text-slate-800">{name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Email</dt>
          <dd className="font-medium text-slate-800">{email}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ProtectedPasswordCard() {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Password</h2>
      <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-800" role="status">
        The protected seed admin password cannot be changed through the application. Ask the system
        operator to rotate it through the deployment seed configuration.
      </p>
    </Card>
  );
}

function ProfileCard({
  profile,
  onSaved,
}: {
  profile: { name: string; email: string };
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const {
    register, handleSubmit, reset, setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(updateOwnProfileSchema),
    defaultValues: { name: profile.name, email: profile.email },
  });

  useEffect(() => {
    reset({ name: profile.name, email: profile.email });
  }, [profile.name, profile.email, reset]);

  async function onSubmit(values: ProfileForm) {
    setStatus(null);
    try {
      const { data } = await profileApi.update(values);
      reset({ name: data.user.name, email: data.user.email });
      await onSaved();
      setStatus({
        tone: "ok",
        message: data.emailChanged
          ? "Profile updated. Use your new email address the next time you sign in."
          : "Profile updated.",
      });
    } catch (e) {
      let focused = false;
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") {
        const { fieldErrors } = validationDetails(e.details);
        for (const field of PROFILE_FIELDS) {
          const messages = fieldErrors[field];
          if (messages?.length) {
            setError(field, { type: "server", message: messages.join(" ") }, { shouldFocus: !focused });
            focused = true;
          }
        }
      }
      setStatus({ tone: "error", message: e instanceof ApiError ? e.message : "Couldn't save your profile." });
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Account details</h2>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <Label htmlFor="profile-name" required>Name</Label>
          <Input
            id="profile-name"
            type="text"
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "profile-name-error" : undefined}
            {...register("name")}
          />
          <FieldError id="profile-name-error" error={errors.name?.message} />
        </div>
        <div>
          <Label htmlFor="profile-email" required>Email</Label>
          <Input
            id="profile-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "profile-email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="profile-email-error" error={errors.email?.message} />
        </div>
        <p className="text-xs text-slate-500">
          Your role, account status and the classes/records linked to this account are managed by the
          institution and cannot be changed here.
        </p>
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting && <Spinner />} Save changes
        </Button>
      </form>
      {status && (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={`mt-3 rounded-lg p-3 text-sm ${status.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {status.message}
        </p>
      )}
    </Card>
  );
}

function PasswordCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const {
    register, handleSubmit, reset, setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(changeOwnPasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: PasswordForm) {
    setStatus(null);
    try {
      await profileApi.changePassword(values);
      reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await onChanged();
      setStatus({ tone: "ok", message: "Password updated. You stay signed in here; other devices must sign in again." });
    } catch (e) {
      let focused = false;
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") {
        const { fieldErrors } = validationDetails(e.details);
        for (const field of PASSWORD_FIELDS) {
          const messages = fieldErrors[field];
          if (messages?.length) {
            setError(field, { type: "server", message: messages.join(" ") }, { shouldFocus: !focused });
            focused = true;
          }
        }
      }
      setStatus({ tone: "error", message: e instanceof ApiError ? e.message : "Couldn't change your password." });
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold">Password</h2>
      <p className="mb-4 text-sm text-slate-500">
        Enter your current password, then choose a new one (at least 8 characters).
      </p>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <Label htmlFor="current-password" required>Current password</Label>
          <PasswordInput
            id="current-password"
            autoComplete="current-password"
            aria-invalid={!!errors.currentPassword}
            aria-describedby={errors.currentPassword ? "current-password-error" : undefined}
            {...register("currentPassword")}
          />
          <FieldError id="current-password-error" error={errors.currentPassword?.message} />
        </div>
        <div>
          <Label htmlFor="new-password" required>New password</Label>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            aria-invalid={!!errors.newPassword}
            aria-describedby={errors.newPassword ? "new-password-error" : undefined}
            {...register("newPassword")}
          />
          <FieldError id="new-password-error" error={errors.newPassword?.message} />
        </div>
        <div>
          <Label htmlFor="confirm-password" required>Confirm new password</Label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
            {...register("confirmPassword")}
          />
          <FieldError id="confirm-password-error" error={errors.confirmPassword?.message} />
        </div>
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
          Changing your password signs out every other device that is using this account.
        </p>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />} Change password
        </Button>
      </form>
      {status && (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={`mt-3 rounded-lg p-3 text-sm ${status.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {status.message}
        </p>
      )}
    </Card>
  );
}
