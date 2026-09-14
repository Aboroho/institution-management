"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { validationDetails } from "@/lib/validation/form-errors";
import { authApi, ApiError } from "@/lib/api/client";
import { Button, Card, Input, Label, FieldError, Spinner } from "@/components/ui";

const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Password is required") });
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [serverError, setServerError] = useState("");
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    setServerError("");
    try {
      const { data } = await authApi.login(values.email, values.password);
      if (next) { router.push(next); router.refresh(); return; }
      router.push(data.role === "ADMIN" ? "/admin/dashboard" : data.role === "TEACHER" ? "/teacher/dashboard" : "/student/dashboard");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") {
        const { fieldErrors } = validationDetails(e.details);
        let focus = true;
        for (const field of ["email", "password"] as const) {
          if (fieldErrors[field]) {
            setError(field, { type: "server", message: fieldErrors[field].join(" ") }, { shouldFocus: focus });
            focus = false;
          }
        }
      }
      setServerError(e instanceof ApiError ? e.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-brand-100 p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">E</span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Educational Management System</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your portal</p>
        </div>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="login-email" required>Email</Label>
            <Input id="login-email" aria-invalid={!!errors.email} aria-describedby={errors.email ? "login-email-error" : undefined} type="email" placeholder="you@institution.edu" autoComplete="username" {...register("email")} />
            <FieldError id="login-email-error" error={errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="login-password" required>Password</Label>
            <Input id="login-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? "login-password-error" : undefined} type="password" placeholder="••••••••" autoComplete="current-password" {...register("password")} />
            <FieldError id="login-password-error" error={errors.password?.message} />
          </div>
          {serverError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{serverError}</p>}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting && <Spinner />} Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
