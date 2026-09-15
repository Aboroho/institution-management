"use client";
// Generic real-API CRUD list page: search, filters, pagination, create/edit dialog.
// Every value comes from the API — no mock data.
import React, { useMemo, useState } from "react";
import { validateFields, validationDetails } from "@/lib/validation/form-errors";
import { getFilterDefaults } from "@/components/filter-defaults";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Pencil, Search } from "lucide-react";
import { get, post, patch, qs, ApiError } from "@/lib/api/client";
import {
  Button, Input, Select, Textarea, Label, FieldError, Table, Badge,
  PageHeader, Pagination, LoadingSkeleton, EmptyState, ErrorState, Dialog, Spinner,
} from "@/components/ui";

export interface Field {
  name: string; label: string;
  type?: "text" | "email" | "password" | "number" | "date" | "datetime" | "select" | "textarea" | "checkbox";
  required?: boolean; options?: { value: string; label: string }[];
  placeholder?: string; createOnly?: boolean; hideInForm?: boolean;
  helper?: string;
}

export interface Column { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode; link?: (row: Record<string, unknown>) => string }

export interface FilterDef { name: string; label: string; options: { value: string; label: string }[] }

interface Props {
  title: string; subtitle?: string; resource: string;
  columns: Column[]; fields: Field[]; filters?: FilterDef[];
  detailHref?: (row: Record<string, unknown>) => string;
  createTitle?: string; editTitle?: string; searchPlaceholder?: string;
  defaultParams?: Record<string, string>;
  badge?: (row: Record<string, unknown>) => React.ReactNode;
}

function val(row: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], row);
}

export function CrudPage(props: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<null | { mode: "create" } | { mode: "edit"; row: Record<string, unknown> }>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const formRef = React.useRef<HTMLFormElement>(null);
  const formId = React.useId();
  const visibleFields = props.fields.filter((f) => !f.hideInForm && !(dialog?.mode === "edit" && f.createOnly));

  const [focusAttempt, setFocusAttempt] = useState(0);
  React.useEffect(() => {
    if (focusAttempt) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [focusAttempt]);

  function updateField(name: string, value: unknown) {
    setForm((previous) => ({ ...previous, [name]: value }));
    // Keep errors on other fields; avoid moving focus while the user types.
    if (fieldErrors[name]) setFieldErrors((previous) => {
      const next = { ...previous }; delete next[name]; return next;
    });
    setFormError("");
  }

  function inputProps(f: Field) {
    return {
      id: `${formId}-${f.name}`, name: f.name, required: f.required,
      "aria-invalid": !!fieldErrors[f.name],
      "aria-describedby": [f.helper ? `${formId}-${f.name}-help` : "", fieldErrors[f.name] ? `${formId}-${f.name}-error` : ""].filter(Boolean).join(" ") || undefined,
    };
  }

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => qs({ page, limit: 25, search: debounced || undefined, ...props.defaultParams, ...filterVals }), [page, debounced, props.defaultParams, filterVals]);
  const { data, error, isLoading, mutate } = useSWR(`${props.resource}${query}`, () => get<Record<string, unknown>[]>(`/${props.resource}${query}`));
  const items = (data?.data ?? []) as Record<string, unknown>[];
  const meta = (data?.meta ?? {}) as { total?: number; page?: number; limit?: number };
  const total = Number(meta.total ?? items.length);

  function openCreate() {
    const defaults = getFilterDefaults(filterVals, {
      relevantFields: visibleFields.map((f) => f.name),
    });
    setForm(defaults);
    setFormError("");
    setFieldErrors({});
    setDialog({ mode: "create" });
  }
  function openEdit(row: Record<string, unknown>) {
    const initial: Record<string, unknown> = {};
    for (const f of props.fields) {
      let v = val(row, f.name);
      if (f.type === "date" && v) v = String(v).slice(0, 10);
      if (f.type === "datetime" && v) v = String(v).slice(0, 16);
      initial[f.name] = (v as string) ?? "";
    }
    setForm(initial); setFormError(""); setFieldErrors({}); setDialog({ mode: "edit", row });
  }

  async function save() {
    if (saving) return;
    const errors = validateFields(visibleFields, form);
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      setFormError("Please correct the highlighted fields before saving.");
      setFocusAttempt((n) => n + 1);
      return;
    }
    setSaving(true);
    try {
      // Strip empty optionals; coerce numbers/checkboxes.
      const payload: Record<string, unknown> = {};
      for (const f of props.fields) {
        if (f.hideInForm) continue;
        if (dialog?.mode === "edit" && f.createOnly) continue;
        let v = form[f.name];
        if (f.type === "checkbox") { payload[f.name] = Boolean(v); continue; }
        if (v === "" || v === undefined) continue;
        if (f.type === "number") v = Number(v);
        payload[f.name] = v;
      }
      if (dialog?.mode === "create") await post(`/${props.resource}`, payload);
      else if (dialog?.mode === "edit") await patch(`/${props.resource}/${dialog.row.id}`, payload);
      setDialog(null);
      await mutate();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(validationDetails(e.details).fieldErrors);
        setFocusAttempt((n) => n + 1);
      }
      setFormError(e instanceof ApiError ? e.message : "Unable to save your changes. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader
        title={props.title} subtitle={props.subtitle}
        actions={<Button onClick={openCreate}><Plus size={16} /> New</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={props.searchPlaceholder ?? "Search..."} className="pl-9" />
        </div>
        {(props.filters ?? []).map((f) => (
          <Select
            key={f.name} value={filterVals[f.name] ?? ""} className="w-auto"
            onChange={(e) => { setFilterVals({ ...filterVals, [f.name]: e.target.value }); setPage(1); }}
            aria-label={f.label}
          >
            <option value="">All {f.label}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}
      </div>

      {isLoading ? <LoadingSkeleton /> : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : "Failed to load"} onRetry={() => mutate()} />
      ) : items.length === 0 ? (
        <EmptyState title={`No ${props.title.toLowerCase()} found`} hint="Create the first record to get started." action={<Button onClick={openCreate}><Plus size={16} /> New</Button>} />
      ) : (
        <>
          <Table headers={[...props.columns.map((c) => c.header), ...(props.badge ? ["Status"] : []), "Actions"]}>
            {items.map((row) => (
              <tr key={String(row.id)} className="hover:bg-slate-50">
                {props.columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    {c.render ? c.render(row) : c.link ? (
                      <Link href={c.link(row)} className="font-medium text-brand-600 hover:underline">{String(val(row, c.key) ?? "—")}</Link>
                    ) : (
                      <span className={c.key === props.columns[0].key ? "font-medium text-slate-900" : "text-slate-600"}>
                        {props.detailHref && c.key === props.columns[0].key ? (
                          <Link href={props.detailHref(row)} className="text-brand-600 hover:underline">{String(val(row, c.key) ?? "—")}</Link>
                        ) : String(val(row, c.key) ?? "—")}
                      </span>
                    )}
                  </td>
                ))}
                {props.badge && <td className="px-4 py-3">{props.badge(row)}</td>}
                <td className="px-4 py-3">
                  <Button variant="ghost" onClick={() => openEdit(row)} aria-label="Edit"><Pencil size={16} /></Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}

      <Dialog open={dialog !== null} title={dialog?.mode === "create" ? (props.createTitle ?? `New ${props.title}`) : (props.editTitle ?? `Edit`)} onClose={() => { if (!saving) setDialog(null); }}>
        <form ref={formRef} noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
          <FieldError error={formError} />
          <fieldset disabled={saving} className="space-y-4">
          {visibleFields.map((f) => (
            <div key={f.name}>
              <Label htmlFor={`${formId}-${f.name}`} required={f.required}>{f.label}</Label>
              {f.type === "select" ? (
                <Select {...inputProps(f)} value={String(form[f.name] ?? "")} onChange={(e) => updateField(f.name, e.target.value)}>
                  <option value="">Select...</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea {...inputProps(f)} value={String(form[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => updateField(f.name, e.target.value)} />
              ) : f.type === "checkbox" ? (
                <input {...inputProps(f)} type="checkbox" checked={Boolean(form[f.name])} onChange={(e) => updateField(f.name, e.target.checked)} className="h-5 w-5 accent-brand-600" />
              ) : (
                <Input
                  {...inputProps(f)}
                  type={f.type === "datetime" ? "datetime-local" : f.type ?? "text"}
                  value={String(form[f.name] ?? "")} placeholder={f.placeholder}
                  onChange={(e) => updateField(f.name, e.target.value)}
                />
              )}
              <FieldError id={`${formId}-${f.name}-error`} error={fieldErrors[f.name]?.join(" ")} />
              {f.helper && <p id={`${formId}-${f.name}-help`} className="mt-1 text-xs text-slate-500">{f.helper}</p>}
            </div>
          ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={saving} variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// Hook: fetch options for selects from a real API list endpoint.
export function useOptions(resource: string, label: (r: Record<string, unknown>) => string, deps = "") {
  const { data } = useSWR(`${resource}-options-${deps}`, () => get<Record<string, unknown>[]>(`/${resource}${deps}`).then((r) => r.data));
  return (data ?? []).map((r) => ({ value: String(r.id), label: label(r) }));
}
