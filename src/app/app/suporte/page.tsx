import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { ORIGIN_LABEL, PRIORITY_LABEL, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL, listTickets } from "@/server/modules/support/tickets";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { dateTime } from "@/lib/format";
import { SlaBadge } from "./sla-badge";

export const dynamic = "force-dynamic";

export default async function SuportePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("support:read");
  const sp = await searchParams;
  const status = sp.status === "done" || sp.status === "all" ? sp.status : "open";
  const tickets = await listTickets(ctx, { status, priority: sp.prioridade || undefined, mine: sp.meus === "1" || undefined });
  return (
    <>
      <PageHeader title="Tickets de suporte" description="SLA calculado no calendário da política, descontando pausas (aguardando terceiro/solicitante). Tickets de motoristas e de alertas entram automaticamente." />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-navy-700">Situação <Select name="status" defaultValue={status} className="mt-1 w-40"><option value="open">Em aberto</option><option value="done">Encerrados</option><option value="all">Todos</option></Select></label>
        <label className="text-sm text-navy-700">Prioridade <Select name="prioridade" defaultValue={sp.prioridade ?? ""} className="mt-1 w-36"><option value="">Todas</option>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label className="flex h-10 items-center gap-2 text-sm text-navy-700"><input type="checkbox" name="meus" value="1" defaultChecked={sp.meus === "1"} /> Só meus</label>
        <button className="h-10 rounded-lg border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">Filtrar</button>
      </form>
      {tickets.length === 0 ? <EmptyState title="Nenhum ticket" /> : (
        <Card>
          <Table>
            <thead><tr><th>Ticket</th><th>Estação / unidade</th><th>Prioridade</th><th>Status</th><th>SLA</th><th>Responsável</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td><Link className="font-medium text-brand-700 hover:underline" href={`/app/suporte/${t.id}`}>{t.number}</Link><p className="max-w-72 truncate text-navy-900">{t.title}</p><p className="text-xs text-navy-400">{TICKET_CATEGORY_LABEL[t.category]} · {ORIGIN_LABEL[t.origin]} · {dateTime(t.createdAt)}</p></td>
                  <td className="text-xs">{t.station?.ocppIdentity ?? "—"}<p>{t.site?.name}</p></td>
                  <td><Badge tone={t.priority === "CRITICAL" ? "red" : t.priority === "HIGH" ? "amber" : "neutral"}>{PRIORITY_LABEL[t.priority]}</Badge></td>
                  <td className="text-xs">{TICKET_STATUS_LABEL[t.status]}</td>
                  <td className="space-y-1"><SlaBadge label="Resposta" s={t.sla.response} /><br /><SlaBadge label="Solução" s={t.sla.resolution} /></td>
                  <td className="text-xs">{t.assignee?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
