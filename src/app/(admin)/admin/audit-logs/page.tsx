"use client";
import { useState } from "react";
import useSWR from "swr";
import { get, qs } from "@/lib/api/client";
import { PageHeader, Button, Table, LoadingSkeleton, EmptyState, ErrorState, Input, Pagination, Breadcrumbs, Dialog, Card } from "@/components/ui";

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const fmt = (v: unknown) => { try { return JSON.stringify(v, null, 2)?.slice(0, 2000); } catch { return str(v); } };

export default function AuditLogsPage() {
  const [f, setF] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Row | null>(null);
  const query = qs({ page, limit: 25, ...f });
  const { data, error, isLoading, mutate } = useSWR(`audit${query}`, () => get<Row[]>(`/audit-logs${query}`));
  const items = (data?.data ?? []) as Row[];
  const total = Number((data?.meta as Record<string, unknown> | undefined)?.total ?? items.length);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Audit Logs" }]} />
      <PageHeader title="Audit Logs" subtitle="Immutable record of who changed what." />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Input placeholder="Actor name/email" value={f.actor ?? ""} onChange={(e) => { setF({ ...f, actor: e.target.value }); setPage(1); }} />
        <Input placeholder="Action" value={f.action ?? ""} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }} />
        <Input placeholder="Entity type" value={f.entity ?? ""} onChange={(e) => { setF({ ...f, entity: e.target.value }); setPage(1); }} />
        <Input type="date" value={f.from ?? ""} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} aria-label="From" />
        <Input type="date" value={f.to ?? ""} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} aria-label="To" />
      </div>
      {isLoading ? <LoadingSkeleton /> : error ? <ErrorState message="Failed to load audit logs" onRetry={() => mutate()} /> : items.length === 0 ? <EmptyState title="No audit logs" /> : (
        <>
          <Table headers={["Date", "Actor", "Action", "Entity", "Entity ID", "Detail"]}>
            {items.map((a) => (
              <tr key={str(a.id)} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm">{new Date(str(a.createdAt)).toLocaleString()}</td>
                <td className="px-4 py-3">{str((a.actor as Row)?.name ?? "System")}</td>
                <td className="px-4 py-3 font-mono text-xs">{str(a.action)}</td>
                <td className="px-4 py-3">{str(a.entityType)}</td>
                <td className="px-4 py-3 font-mono text-xs">{str(a.entityId).slice(0, 12)}…</td>
                <td className="px-4 py-3"><Button variant="outline" onClick={() => setDetail(a)}>View</Button></td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} limit={25} total={total} onPage={setPage} />
        </>
      )}
      <Dialog open={detail !== null} title="Audit detail" onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-3 text-sm">
            <p><strong>Actor:</strong> {str((detail.actor as Row)?.name ?? "System")} · <strong>IP:</strong> {str(detail.ip ?? "—")}</p>
            <p><strong>Action:</strong> <span className="font-mono text-xs">{str(detail.action)}</span> · <strong>Entity:</strong> {str(detail.entityType)} / {str(detail.entityId)}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Card className="p-3"><p className="mb-1 font-semibold">Old values</p><pre className="max-h-64 overflow-auto text-xs">{fmt(detail.oldValues)}</pre></Card>
              <Card className="p-3"><p className="mb-1 font-semibold">New values</p><pre className="max-h-64 overflow-auto text-xs">{fmt(detail.newValues)}</pre></Card>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
