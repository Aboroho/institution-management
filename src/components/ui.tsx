"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, AlertTriangle, Inbox, ChevronLeft, ChevronRight, ChevronDown, Search, Check } from "lucide-react";

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
      className={cn("w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-100", className)}
    />
  ),
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      {...props}
      className={cn("w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-100", className)}
    />
  ),
);
Select.displayName = "Select";

// ---------- Searchable select (combobox) ----------
export type SelectOption = { value: string; label: string; search?: string };

export function SearchableSelect({
  options,
  loadOptions,
  value,
  onChange,
  clearLabel,
  placeholder = "Select...",
  disabled,
  ariaLabel,
  className,
  minQuery = 0,
}: {
  /** Static options, filtered client-side. Provide this OR `loadOptions`. */
  options?: SelectOption[];
  /** Remote options. Provide this OR `options`. Called with the search query. */
  loadOptions?: (query: string) => Promise<SelectOption[]>;
  value: string;
  onChange: (value: string) => void;
  /** Label of the leading "clear/All" row (value ""). Omit to hide it. */
  clearLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** For `loadOptions`: minimum query length before searching. */
  minQuery?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SelectOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reqId = useRef(0);

  const list = loadOptions ? (remote ?? []) : (options ?? []);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (loadOptions ? list : list.filter((o) => !q || (o.search ?? o.label.toLowerCase()).includes(q))),
    [list, q, loadOptions],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items: SelectOption[] = clearLabel != null ? [{ value: "", label: clearLabel }, ...filtered] : filtered;

  // Fetch remote options (debounced) while open.
  useEffect(() => {
    if (!open || !loadOptions) return;
    if (query.trim().length < minQuery) {
      setRemote([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await loadOptions(query.trim());
        if (reqId.current === id) {
          setRemote(res);
          setActive(0);
        }
      } catch {
        if (reqId.current === id) setRemote([]);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, query, loadOptions, minQuery]);

  // Reset + focus search input when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Reset keyboard cursor when the visible list changes (static mode).
  useEffect(() => {
    if (open && !loadOptions) setActive(0);
  }, [open, q, loadOptions]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the active row in view.
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function select(v: string) {
    const opt = list.find((o) => o.value === v);
    setSelectedLabel(v && opt ? opt.label : null);
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const displayLabel = value
    ? (list.find((o) => o.value === value)?.label ?? selectedLabel ?? "")
    : "";

  let hint: string | null = null;
  if (loading) hint = "Searching...";
  else if (loadOptions != null && query.trim().length < minQuery) hint = `Type at least ${minQuery} characters to search.`;
  else if (filtered.length === 0) hint = q || loadOptions != null ? "No matches" : "No options";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-brand-500 ring-2 ring-brand-100",
        )}
      >
        <span className={cn("truncate", !value && "text-slate-400")}>{value ? displayLabel : placeholder}</span>
        <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const o = items[active];
                  if (o) select(o.value);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={ariaLabel ? `Search ${ariaLabel}...` : "Search..."}
              aria-label={ariaLabel ? `Search ${ariaLabel}` : "Search options"}
              className="w-full  bg-transparent py-2  text-sm text-slate-700 outline-none placeholder:text-slate-400 focus-visible:outline-none"
            />
          </div>
          <div role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto py-1">
            {items.map((o, i) => (
              <button
                key={o.value || "__clear__"}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                  i === active && "bg-slate-100",
                  o.value === value ? "font-medium text-brand-700" : "text-slate-700",
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check size={14} className="shrink-0 text-brand-600" />}
              </button>
            ))}
            {hint && <p className="px-3 py-2 text-sm text-slate-400">{hint}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      {...props}
      className={cn("w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-100", className)}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ children, required, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">{children}{required && <span className="ml-1 text-red-500">*</span>}</label>;
}

export function FieldError({ error, id }: { error?: string; id?: string }) {
  if (!error) return null;
  return <p id={id} role="alert" className="mt-1 text-xs text-red-600">{error}</p>;
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
