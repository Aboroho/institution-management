"use client";
// Generic real-API CRUD list page: search, filters, pagination, create/edit dialog.
// Every value comes from the API — no mock data.
import React, { useMemo, useState } from "react";
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

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => qs({ page, limit: 25, search: debounced || undefined, ...props.defaultParams, ...filterVals }), [page, debounced, props.defaultParams, filterVals]);
  const { data, error, isLoading, mutate } = useSWR(`${props.resource}${query}`, () => get<Record<string, unknown>[]>(`/${props.resource}${query}`));
  const items = (data?.data ?? []) as Record<string, unknown>[];
  const meta = (data?.meta ?? {}) as { total?: number; page?: number; limit?: number };
  const total = Number(meta.total ?? items.length);

  function openCreate() { setForm({}); setFormError(""); setDialog({ mode: "create" }); }
  function openEdit(row: Record<string, unknown>) {
    const initial: Record<string, unknown> = {};
    for (const f of props.fields) {
      let v = val(row, f.name);
      if (f.type === "date" && v) v = String(v).slice(0, 10);
      if (f.type === "datetime" && v) v = String(v).slice(0, 16);
      initial[f.name] = (v as string) ?? "";
    }
    setForm(initial); setFormError(""); setDialog({ mode: "edit", row });
  }

  async function save() {
    setSaving(true); setFormError("");
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
      setFormError(e instanceof ApiError ? e.message : "Save failed");
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

      <Dialog open={dialog !== null} title={dialog?.mode === "create" ? (props.createTitle ?? `New ${props.title}`) : (props.editTitle ?? `Edit`)} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          {props.fields.filter((f) => !f.hideInForm && !(dialog?.mode === "edit" && f.createOnly)).map((f) => (
            <div key={f.name}>
              <Label required={f.required}>{f.label}</Label>
              {f.type === "select" ? (
                <Select value={String(form[f.name] ?? "")} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                  <option value="">Select...</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea value={String(form[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
              ) : f.type === "checkbox" ? (
                <input type="checkbox" checked={Boolean(form[f.name])} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} className="h-5 w-5 accent-brand-600" />
              ) : (
                <Input
                  type={f.type === "datetime" ? "datetime-local" : f.type ?? "text"}
                  value={String(form[f.name] ?? "")} placeholder={f.placeholder}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
              {f.helper && <p className="mt-1 text-xs text-slate-500">{f.helper}</p>}
            </div>
          ))}
          <FieldError error={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner />} Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// Hook: fetch options for selects from a real API list endpoint.
export function useOptions(resource: string, label: (r: Record<string, unknown>) => string, deps = "") {
  const { data } = useSWR(`${resource}-options-${deps}`, () => get<Record<string, unknown>[]>(`/${resource}${deps}`).then((r) => r.data));
  return (data ?? []).map((r) => ({ value: String(r.id), label: label(r) }));
}
