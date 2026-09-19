"use client";

/**
 * Searchable multi-select for datasets that do not fit on a screen.
 *
 * The problem it solves: recipient pickers used to render every student and
 * every course offering the backend returned, which is fine with 40 students
 * and unusable with 4,000. This control never holds more than one page of
 * options in the DOM — it asks the API for matches as the user types and loads
 * further pages on demand.
 *
 * Contracts that matter:
 *   - Selections are owned by the caller and are NEVER derived from the
 *     currently loaded page, so searching, paging or clearing the query cannot
 *     silently drop a choice the user already made.
 *   - Every request carries a sequence number; a response that is not the
 *     newest is discarded, so a slow "a" cannot overwrite the results for
 *     "abdul".
 *   - The query is debounced and identical queries are not re-issued.
 *   - Select-all is deliberately scoped to *loaded matches* and says so, because
 *     "all eligible" is not knowable client-side for a paginated dataset.
 *   - Authorisation stays on the server: this only renders what the API
 *     returned, and the backend re-validates every submitted id.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Badge, Button, InlineLoading, Tooltip, cn } from "@/components/ui";

export interface MultiSelectOption {
  id: string;
  label: string;
  /** Optional second line (e.g. email, context code). */
  hint?: string;
}

export interface MultiSelectPage {
  options: MultiSelectOption[];
  /** True when another page exists for this query. */
  hasMore: boolean;
}

export interface SearchableMultiSelectProps {
  label: string;
  /** Currently selected options (id + label), owned by the parent form. */
  selected: MultiSelectOption[];
  onChange: (next: MultiSelectOption[]) => void;
  /**
   * Fetches one page of authorized matches. Must be stable (useCallback).
   * `signal` aborts superseded requests.
   */
  loadPage: (args: { query: string; page: number; signal: AbortSignal }) => Promise<MultiSelectPage>;
  placeholder?: string;
  /** Shown when the API returns nothing for the current query. */
  emptyMessage?: string;
  disabled?: boolean;
  /** Offer "Select all loaded matches". Off where the semantics would be unclear. */
  allowSelectAllLoaded?: boolean;
  /** Short explanation of who this group reaches. */
  tooltip?: React.ReactNode;
  className?: string;
  /** Debounce for keystrokes, in ms. */
  debounceMs?: number;
}

const PAGE_LIMIT_HINT = "Only matching records are loaded — refine the search to find more.";

export function SearchableMultiSelect({
  label,
  selected,
  onChange,
  loadPage,
  placeholder,
  emptyMessage = "No matches",
  disabled = false,
  allowSelectAllLoaded = false,
  tooltip,
  className,
  debounceMs = 250,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MultiSelectOption[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const listId = useId();
  const statusId = useId();

  const selectedIds = useMemo(() => new Set(selected.map((option) => option.id)), [selected]);

  const runSearch = useCallback(
    async (nextQuery: string, nextPage: number) => {
      const id = ++requestId.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (nextPage === 1) setLoading(true); else setLoadingMore(true);
      setError("");
      try {
        const result = await loadPage({ query: nextQuery, page: nextPage, signal: controller.signal });
        // Stale response: a newer keystroke already started its own request.
        if (id !== requestId.current) return;
        setOptions((current) => (nextPage === 1 ? result.options : [...current, ...result.options]));
        setHasMore(result.hasMore);
        setPage(nextPage);
        if (nextPage === 1) setActive(0);
      } catch (caught) {
        if (id !== requestId.current) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Options could not be loaded.");
        if (nextPage === 1) setOptions([]);
        setHasMore(false);
      } finally {
        if (id === requestId.current) { setLoading(false); setLoadingMore(false); }
      }
    },
    [loadPage],
  );

  // Debounced query -> first page. Runs only while the panel is open so a closed
  // picker costs nothing.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void runSearch(query.trim(), 1); }, query.trim() ? debounceMs : 0);
    return () => clearTimeout(timer);
  }, [open, query, runSearch, debounceMs]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, options]);

  function toggle(option: MultiSelectOption) {
    // Toggling never rebuilds the list from `options`, so a selected record that
    // has scrolled out of the current result set stays selected.
    onChange(selectedIds.has(option.id) ? selected.filter((item) => item.id !== option.id) : [...selected, option]);
  }

  function selectAllLoaded() {
    const additions = options.filter((option) => !selectedIds.has(option.id));
    if (additions.length) onChange([...selected, ...additions]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option) toggle(option);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  }

  const count = selected.length;
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50",
        open && "border-brand-500 ring-2 ring-brand-100",
      )}
    >
      <span className={cn("truncate", count === 0 && "text-slate-400")}>
        {count === 0 ? (placeholder ?? `Search ${label.toLowerCase()}...`) : `${count} selected`}
      </span>
      <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
    </button>
  );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {tooltip && (
          <Tooltip content={tooltip}>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-500 hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span aria-hidden="true">?</span>
              <span className="sr-only">{`About ${label}`}</span>
            </button>
          </Tooltip>
        )}
        {count > 0 && <span className="ml-auto text-xs font-medium text-brand-700">{count} selected</span>}
      </div>

      {trigger}

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Search ${label.toLowerCase()}...`}
              aria-label={`Search ${label}`}
              aria-describedby={statusId}
              autoComplete="off"
              className="w-full bg-transparent py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
            {loading && <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin text-brand-600" />}
          </div>

          <div id={listId} ref={listRef} role="listbox" aria-multiselectable aria-label={label} className="max-h-56 overflow-y-auto py-1">
            {loading && options.length === 0 ? (
              <div className="space-y-2 px-3 py-2" aria-hidden="true">
                {[0, 1, 2].map((row) => <div key={row} className="h-4 animate-pulse rounded bg-slate-100" />)}
              </div>
            ) : error ? (
              <div className="px-3 py-3 text-sm">
                <p role="alert" className="text-red-600">{error}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void runSearch(query.trim(), 1)}>Retry</Button>
              </div>
            ) : options.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">{emptyMessage}</p>
            ) : (
              options.map((option, index) => {
                const checked = selectedIds.has(option.id);
                return (
                  <button
                    key={option.id}
                    ref={(el) => { itemRefs.current[index] = el; }}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => toggle(option)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm",
                      index === active && "bg-slate-100",
                      checked ? "text-brand-800" : "text-slate-700",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white",
                      )}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block truncate", checked && "font-medium")}>{option.label}</span>
                      {option.hint && <span className="block truncate text-xs text-slate-500">{option.hint}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div id={statusId} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span aria-live="polite">
              {loading ? <InlineLoading label="Searching…" /> : `${options.length} shown${hasMore ? "+" : ""} · ${count} selected`}
            </span>
            <span className="flex items-center gap-2">
              {allowSelectAllLoaded && options.length > 0 && !loading && (
                <Tooltip content={`Selects the ${options.length} record${options.length === 1 ? "" : "s"} currently listed, not every eligible record.`}>
                  <button
                    type="button"
                    onClick={selectAllLoaded}
                    className="rounded font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    Select {options.length} shown
                  </button>
                </Tooltip>
              )}
              {hasMore && (
                <Button size="sm" variant="ghost" loading={loadingMore} loadingText="Loading…" onClick={() => void runSearch(query.trim(), page + 1)}>
                  Load more
                </Button>
              )}
            </span>
          </div>
        </div>
      )}

      {count > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Selected ${label}`}>
          {selected.map((option) => (
            <li key={option.id}>
              <Badge tone="blue">
                <span className="mr-1 max-w-[16rem] truncate">{option.label}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${option.label}`}
                  onClick={() => onChange(selected.filter((item) => item.id !== option.id))}
                  className="rounded-full p-0.5 hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {hasMore && open && <p className="sr-only">{PAGE_LIMIT_HINT}</p>}
    </div>
  );
}
