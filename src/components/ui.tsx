"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  Loader2, AlertTriangle, AlertCircle, CheckCircle2, Info, Inbox, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, Search, Check, Eye, EyeOff, X,
} from "lucide-react";

export const cn = (...xs: (string | false | null | undefined)[]) => twMerge(clsx(xs));

// ---------- Buttons / inputs ----------
/**
 * One button scale for the whole app.
 *
 *   md  — the default: page-level actions (Save, Approve, Apply filters).
 *   sm  — inline/row actions and secondary controls; keeps touch targets
 *         comfortable on mobile without looking oversized on desktop.
 *
 * Only two sizes exist on purpose: pages that invent their own padding are how
 * the app drifted into "one screen, five button heights".
 *
 * `loading` is the single way the app says "your click is being processed":
 * it swaps the leading icon for a spinner, marks the control `aria-busy`, and
 * disables the button so a second click cannot submit the same request twice.
 * It reflects a real in-flight operation — never a timer.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md";
  /** True while the action this button triggered is actually running. */
  loading?: boolean;
  /** Optional replacement label while loading (e.g. "Saving..."). */
  loadingText?: React.ReactNode;
}) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
    >
      {loading && <Loader2 size={size === "sm" ? 14 : 16} className="shrink-0 animate-spin" aria-hidden="true" />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

/** The shared class recipe, so links that navigate can look exactly like buttons. */
export function buttonClass(
  variant: "primary" | "secondary" | "danger" | "ghost" | "outline" = "primary",
  size: "sm" | "md" = "md",
  className?: string,
) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-slate-100",
    outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  } as const;
  const sizes = {
    sm: "gap-1.5 rounded-lg px-3 py-1.5 text-[13px]",
    md: "gap-2 rounded-lg px-4 py-2 text-sm",
  } as const;
  return cn(
    "inline-flex items-center justify-center font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
    sizes[size],
    styles[variant],
    className,
  );
}

// ---------- Tooltip ----------
/**
 * The app's one tooltip.
 *
 * Used for controls whose meaning is not obvious from their label — icon-only
 * buttons, correction limits, recipient scopes, destructive actions. It is not
 * a decoration: adding one to a button that already says what it does only adds
 * noise, so keep the text short and specific.
 *
 * Behaviour: opens on hover, on keyboard focus and on touch (the trigger keeps
 * its own click handler), closes on Escape / blur / pointer-leave. The bubble is
 * `role="tooltip"` and wired to the trigger with `aria-describedby`, so screen
 * readers announce it with the control instead of as stray text.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  /** Short explanation. Omit (or pass empty) to render the child unchanged. */
  content?: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!content) return children;

  const show = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 60); };

  const describedBy = [children.props["aria-describedby"], open ? id : null].filter(Boolean).join(" ") || undefined;
  const trigger = React.cloneElement(children, { "aria-describedby": describedBy });

  const sides = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  } as const;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      // Touch: a tap reveals the explanation without blocking the control's own action.
      onTouchStart={show}
    >
      {trigger}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg",
            sides[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * Icon-only button. The label is mandatory: it becomes both the accessible name
 * and the tooltip, so an icon never ships without an explanation.
 */
export function IconButton({
  label,
  icon,
  tooltip,
  variant = "ghost",
  size = "sm",
  side = "top",
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  label: string;
  icon: React.ReactNode;
  /** Longer explanation; defaults to `label`. */
  tooltip?: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md";
  side?: "top" | "bottom" | "left" | "right";
  loading?: boolean;
}) {
  const { loading, disabled, ...rest } = props;
  return (
    <Tooltip content={tooltip ?? label} side={side}>
      <button
        {...rest}
        type={rest.type ?? "button"}
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={buttonClass(variant, size, cn(size === "sm" ? "!px-2" : "!px-2.5", className))}
      >
        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
      </button>
    </Tooltip>
  );
}

/** A small "?" affordance for explaining a field or option next to its label. */
export function HelpHint({ children, side = "top" }: { children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip content={children} side={side}>
      <button
        type="button"
        // Purely explanatory: it opens nothing, so it must not be a tab trap on mobile.
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-500 hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">More information</span>
      </button>
    </Tooltip>
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

/**
 * Password field with a show/hide toggle.
 *
 * The toggle is a real button (keyboard reachable, `aria-pressed`, named for screen
 * readers) and never changes the submitted value — only how it is rendered.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

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
  loading: externalLoading = false,
  emptyMessage,
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
  /**
   * Async option loading (parent fetches options from the backend). Shows an
   * inline spinner INSIDE the select trigger while true.
   */
  loading?: boolean;
  /** Empty-state text when there are no options (e.g. "No semesters available"). */
  emptyMessage?: string;
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

  // Memoised so the option list keeps a stable identity across renders (the
  // `filtered` memo below depends on it) — dependent selects pass a fresh
  // `options` array only when the backend data actually changed.
  const list = useMemo(
    () => (loadOptions ? (remote ?? []) : (options ?? [])),
    [loadOptions, remote, options],
  );
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

  const busy = loading || externalLoading;
  let hint: string | null = null;
  if (busy) hint = "Loading...";
  else if (loadOptions != null && query.trim().length < minQuery) hint = `Type at least ${minQuery} characters to search.`;
  else if (filtered.length === 0) hint = q || loadOptions != null ? "No matches" : (emptyMessage ?? "No options");

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || externalLoading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-busy={busy}
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
        {externalLoading ? (
          <Loader2 size={16} className="shrink-0 animate-spin text-brand-600" aria-label="Loading options" />
        ) : (
          <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
        )}
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

export function Label({ children, required, htmlFor }: { children?: React.ReactNode; required?: boolean; htmlFor?: string }) {
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
export function Table({ headers, children, busy = false }: { headers: string[]; children: React.ReactNode; busy?: boolean }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Refreshing an already-loaded table dims it instead of replacing it with a
          skeleton, so the rows the user was reading do not disappear. */}
      <table aria-busy={busy || undefined} className={cn("w-full min-w-[640px] text-left text-sm transition-opacity", busy && "opacity-60")}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {headers.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold text-slate-600">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {busy && (
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-brand-700 shadow-sm">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Updating
        </span>
      )}
    </div>
  );
}

// ---------- States ----------
/**
 * Loading placeholders.
 *
 * A skeleton exists to reserve the shape of the content that is coming, so use
 * the variant that matches it — a table skeleton for a table, cards for cards.
 * A wall of identical grey bars in place of a form is worse than no skeleton at
 * all, because the layout jumps the moment the real content arrives.
 */
/*
 * The generic `LoadingSkeleton` (a stack of identical grey bars) was removed on
 * purpose. It was rendered on 51 screens as a stand-in for tables, forms,
 * dashboards and detail panels alike, so the placeholder never matched the
 * content and every screen jumped when the data arrived. Use the shaped
 * skeletons below — `TableSkeleton`, `CardSkeleton`/`CardListSkeleton`,
 * `StatCardsSkeleton`, `FormSkeleton`, `TextBlockSkeleton`, `DetailSkeleton`,
 * `DashboardSkeleton` — and pick the one whose shape the real content has.
 */

/** Table placeholder: same column count, header row and cell rhythm as `Table`. */
export function TableSkeleton({ columns, rows = 6, label = "Loading table" }: { columns: number; rows?: number; label?: string }) {
  const widths = ["w-24", "w-32", "w-20", "w-28", "w-16", "w-36"];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="status" aria-label={label} aria-live="polite">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className={cn("h-3.5 animate-pulse rounded bg-slate-200", widths[i % widths.length])} />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className={cn("h-4 animate-pulse rounded bg-slate-100", widths[(r + c) % widths.length])} />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Card-list / grid placeholder matching `Card` padding and radius. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn("h-3 animate-pulse rounded bg-slate-100", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </Card>
  );
}

export function CardListSkeleton({ count = 3, lines = 3, className, label = "Loading list" }: { count?: number; lines?: number; className?: string; label?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label={label} aria-live="polite">
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} lines={lines} />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Stat-tile row placeholder with the same height as `StatCard`. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading summary" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-center justify-between">
            <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="mt-3 h-8 w-20 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-100" />
        </Card>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Form placeholder: label + control pairs at the real field spacing. */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn("space-y-4", className)} role="status" aria-label="Loading form" aria-live="polite">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <div className="mb-1 h-3.5 w-28 animate-pulse rounded bg-slate-200" />
          <div className="h-[38px] animate-pulse rounded-lg bg-slate-100" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Long-form article placeholder (notice body, notification detail). */
export function TextBlockSkeleton({ lines = 5, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} role="status" aria-label="Loading content" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={cn("h-3.5 animate-pulse rounded bg-slate-100", i === lines - 1 ? "w-1/2" : i % 3 === 1 ? "w-11/12" : "w-full")} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Detail-record placeholder: a summary panel of label/value pairs followed by an
 * optional table. Matches the shape every `[id]` page renders, so the content
 * lands in the same place the skeleton occupied instead of shifting the page.
 */
export function DetailSkeleton({ fields = 6, withTable = true, label = "Loading details" }: { fields?: number; withTable?: boolean; label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label} aria-live="polite">
      <Card className="p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
              <div className="mt-1.5 h-4 w-32 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </Card>
      {withTable && <TableSkeleton columns={4} rows={4} label={label} />}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Dashboard placeholder: stat tiles above side-by-side panels. */
export function DashboardSkeleton({ stats = 4, panels = 2 }: { stats?: number; panels?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard" aria-live="polite">
      <StatCardsSkeleton count={stats} />
      <div className={cn("grid grid-cols-1 gap-4", panels > 1 && "lg:grid-cols-2")}>
        {Array.from({ length: panels }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3].map((r) => (
                <div key={r} className="flex items-center justify-between gap-4">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-slate-100" />
                  <div className="h-3.5 w-16 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({ title = "No data", hint, action }: { title?: string; hint?: string; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="rounded-full bg-slate-100 p-3 text-slate-400"><Inbox size={24} aria-hidden="true" /></span>
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="max-w-md text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void | Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  }
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="rounded-full bg-red-50 p-3 text-red-500"><AlertTriangle size={24} aria-hidden="true" /></span>
      <p className="font-semibold text-slate-700">Something went wrong</p>
      <p role="alert" className="max-w-md text-sm text-slate-500">{message}</p>
      {onRetry && <Button variant="outline" className="mt-2" loading={retrying} loadingText="Retrying…" onClick={() => void retry()}>Retry</Button>}
    </Card>
  );
}

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <>
      <Loader2 className={cn("animate-spin", className)} size={size} aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

/**
 * Inline "this section is refreshing" marker. Sits next to the control or the
 * heading of the content being updated instead of blanking the whole page.
 */
export function InlineLoading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-slate-500", className)}>
      <Loader2 size={13} className="animate-spin" aria-hidden="true" /> {label}
    </span>
  );
}

/**
 * Result of an action. Status is carried by an icon + text, never by colour
 * alone, and `role` switches to `alert` for errors so it is announced.
 */
export function StatusMessage({
  tone,
  children,
  onDismiss,
  className,
}: {
  tone: "success" | "error" | "info" | "warning";
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const config = {
    success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
    error: { cls: "border-red-200 bg-red-50 text-red-700", Icon: AlertCircle },
    info: { cls: "border-slate-200 bg-slate-50 text-slate-700", Icon: Info },
    warning: { cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: AlertTriangle },
  } as const;
  const { cls, Icon } = config[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn("mb-4 flex items-start gap-2.5 rounded-lg border p-3 text-sm", cls, className)}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ---------- Long content ----------
/**
 * Preview-then-expand for long text (notice bodies, notification messages).
 *
 * Renders a clamped preview and only shows the toggle when the content actually
 * overflows, so short messages never gain a pointless "Show more". The toggle is
 * a real button: keyboard reachable, `aria-expanded`, and it stops click
 * propagation so it cannot trigger the surrounding card's navigation.
 */
export function ExpandableText({
  text,
  lines = 3,
  className,
  moreLabel = "Show more",
  lessLabel = "Show less",
}: {
  text: string;
  /** Clamp height in lines while collapsed. */
  lines?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const bodyId = useId();

  // Measure instead of guessing a character count: whether text is "long"
  // depends on the viewport width, not on its length.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setOverflows(el.scrollHeight - el.clientHeight > 4);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded, lines]);

  const clamp = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 5: "line-clamp-5", 6: "line-clamp-6" } as const;

  return (
    <div className={className}>
      <p
        ref={bodyRef}
        id={bodyId}
        className={cn("max-w-prose whitespace-pre-wrap break-words text-sm leading-6 text-slate-600", !expanded && clamp[lines])}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); setExpanded((v) => !v); }}
          className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {expanded ? <><ChevronUp size={13} aria-hidden="true" /> {lessLabel}</> : <><ChevronDown size={13} aria-hidden="true" /> {moreLabel}</>}
        </button>
      )}
    </div>
  );
}

// ---------- Pagination ----------
export function Pagination({ page, limit, total, onPage, busy = false }: { page: number; limit: number; total: number; onPage: (p: number) => void; busy?: boolean }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p className="flex items-center gap-2">
        <span>Page {page} of {totalPages} · {total} {total === 1 ? "record" : "records"}</span>
        {busy && <InlineLoading label="Loading page…" />}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /> Prev</Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages || busy} onClick={() => onPage(page + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></Button>
      </div>
    </nav>
  );
}

// ---------- Tabs ----------
export function Tabs({
  tabs,
  active,
  onChange,
  label = "Sections",
}: {
  tabs: { id: string; label: string; count?: number; hint?: string }[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKeyDown(event: React.KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === active);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0 && event.key !== "Home") return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    onChange(target.id);
    refs.current[target.id]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const selected = active === t.id;
        const button = (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
              selected ? "border-b-2 border-brand-600 text-brand-700" : "border-b-2 border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-bold", selected ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600")}>{t.count}</span>
            )}
          </button>
        );
        return t.hint ? <Tooltip key={t.id} content={t.hint}>{button}</Tooltip> : button;
      })}
    </div>
  );
}

// ---------- Dialog ----------
/**
 * Accessible modal used by every confirm/detail dialog in the app.
 *
 * Keyboard contract (added for the attendance dialogs, so it applies to all):
 *   - Escape closes (unless the caller forbids it while a mutation is running),
 *   - focus moves into the dialog on open and returns to the trigger on close,
 *   - the panel is labelled by its title, and Tab stays inside the dialog.
 */
export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  wide,
  size,
  labelledBy,
}: {
  open: boolean;
  title: string;
  /** One short line under the title. Skip it when the title already says it. */
  description?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  /** Back-compat alias for `size="lg"`. */
  wide?: boolean;
  /** sm — confirmations, md — forms (default), lg — dense/multi-column. */
  size?: "sm" | "md" | "lg";
  /** Set false while a submit/cancel request is in flight to avoid lost work. */
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // The page behind a modal must not scroll away under it.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    // Focus the panel (or its first control) so keyboard users land inside the
    // dialog instead of tabbing through the page behind it.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panelRef.current)?.focus();
    const previouslyFocused = restoreRef.current as HTMLElement | null;
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-xl outline-none sm:max-h-[90vh] sm:rounded-xl",
          (size ?? (wide ? "lg" : "md")) === "sm" ? "sm:max-w-md" : (size ?? (wide ? "lg" : "md")) === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Close dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {/* Body scrolls on its own so the header and the action row stay reachable
            on short/ narrow screens. */}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Concise confirmation for destructive or irreversible actions.
 *
 * Replaces `window.confirm`, which cannot show a processing state: here the
 * confirm button stays disabled and spinning until the request settles, the
 * dialog cannot be dismissed mid-flight, and a failure is shown inside the
 * dialog so the user can retry instead of wondering whether it worked.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} size="sm" title={title} onClose={() => { if (!busy) onClose(); }}>
      <div className="text-sm text-slate-600">{message}</div>
      {error && <StatusMessage tone="error" className="mb-0 mt-4">{error}</StatusMessage>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>{cancelLabel}</Button>
        <Button variant={tone} loading={busy} loadingText="Working…" onClick={() => void onConfirm()}>{confirmLabel}</Button>
      </div>
    </Dialog>
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
