"use client";
import React from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, AlertTriangle, Inbox, ChevronLeft, ChevronRight } from "lucide-react";

export const cn = (...xs: (string | false | null | undefined)[]) => twMerge(clsx(xs));

// ---------- Buttons / inputs ----------
export function Button({ variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "outline" }) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-slate-100",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
  } as const;
  return (
    <button
      {...props}
      className={cn("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50", styles[variant], className)}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn("w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100", className)}
    />
  ),
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      {...props}
      className={cn("w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100", className)}
    />
  ),
);
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      {...props}
      className={cn("w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100", className)}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <label className="mb-1 block text-sm font-medium text-slate-700">{children}{required && <span className="ml-1 text-red-500">*</span>}</label>;
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="mt-1 text-xs text-red-600">{error}</p>;
}

// ---------- Cards / layout ----------
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = "blue" }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: "blue" | "green" | "amber" | "red" | "violet" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700",
  } as const;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <span className={cn("rounded-lg p-2", tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

// ---------- Badges ----------
export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "blue" | "violet"; children: React.ReactNode }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800", violet: "bg-violet-100 text-violet-800",
  } as const;
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "green" | "red" | "amber" | "blue" | "violet" | "slate"> = {
    ACTIVE: "green", PRESENT: "green", APPROVED: "green", PROMOTED: "green", COMPLETED: "green", SENT: "green",
    ABSENT: "red", REJECTED: "red", FAILED: "red",
    LATE: "amber", PENDING: "amber", REPEATING: "amber", EXCUSED: "blue", WITHDRAWN: "slate", TRANSFERRED: "violet",
  };
  return <Badge tone={map[status] ?? "slate"}>{status.replace(/_/g, " ")}</Badge>;
}

// ---------- Tables ----------
export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {headers.map((h) => <th key={h} className="px-4 py-3 font-semibold text-slate-600">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

// ---------- States ----------
export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

export function EmptyState({ title = "No data", hint, action }: { title?: string; hint?: string; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="rounded-full bg-slate-100 p-3 text-slate-400"><Inbox size={24} /></span>
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
      {action}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="rounded-full bg-red-50 p-3 text-red-500"><AlertTriangle size={24} /></span>
      <p className="font-semibold text-slate-700">Something went wrong</p>
      <p className="text-sm text-slate-500">{message}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
    </Card>
  );
}

export function Spinner() {
  return <Loader2 className="animate-spin" size={16} />;
}

// ---------- Pagination ----------
export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <p>Page {page} of {totalPages} · {total} records</p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /> Prev</Button>
        <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

// ---------- Tabs ----------
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn("px-4 py-2.5 text-sm font-medium", active === t.id ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-800")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Dialog ----------
export function Dialog({ open, title, children, onClose, wide }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className={cn("max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">/</span>}
          {it.href ? <Link href={it.href} className="hover:text-brand-600">{it.label}</Link> : <span className="font-medium text-slate-700">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
