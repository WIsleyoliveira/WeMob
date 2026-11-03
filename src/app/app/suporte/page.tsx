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
import { ButtonLink } from "@/components/ui/button";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { SegmentedLinks } from "@/components/ui/segmented";
import { hrefWith } from "@/lib/query";

const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const dynamic = "force-dynamic";

export default async function SuportePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("support:read");
  const sp = await searchParams;
  const status = sp.status === "done" || sp.status === "all" ? sp.status : "open";
  const [found, open] = await Promise.all([
    listTickets(ctx, { status, priority: sp.prioridade || undefined, mine: sp.meus === "1" || undefined }),
    listTickets(ctx, { status: "open" }),
  ]);
  const tickets = found.filter((t) => (!sp.categoria || t.category === sp.categoria) && (!sp.q || norm(`${t.number} ${t.title} ${t.station?.ocppIdentity ?? ""} ${t.site?.name ?? ""}`).includes(norm(sp.q))));
  const breached = open.filter((t) => t.sla.response.state === "BREACHED" || t.sla.resolution.state === "BREACHED");
  const atRisk = open.filter((t) => !breached.includes(t) && (t.sla.response.state === "AT_RISK" || t.sla.resolution.state === "AT_RISK"));
  const tab = (st: string) => hrefWith("/app/suporte", { prioridade: sp.prioridade, meus: sp.meus, categoria: sp.categoria, q: sp.q }, { status: st === "open" ? null : st });
  const filtered = !!(sp.prioridade || sp.meus || sp.categoria || sp.q);
  return (
    <>
      <PageHeader
        title="Chamados de suporte"
        description="Prazo (SLA) contado no calendário da política, descontando pausas. Chamados de motoristas e de alertas entram automaticamente."
        actions={ctx.permissions.has("support:write") && <ButtonLink href="/app/suporte/novo">Novo chamado</ButtonLink>}
      />
      <SummaryStrip
        label="Resumo dos chamados abertos"
        items={[
          { label: "Em aberto", value: open.length, href: tab("open"), current: status === "open" && !filtered },
          { label: "Prazo estourado", value: breached.length, tone: breached.length ? "danger" : "default", hint: "resposta ou solução" },
          { label: "Prazo em risco", value: atRisk.length, tone: atRisk.length ? "warning" : "default", hint: "80% do prazo consumido" },
          { label: "Críticos", value: open.filter((t) => t.priority === "CRITICAL").length, tone: open.some((t) => t.priority === "CRITICAL") ? "danger" : "default", href: hrefWith("/app/suporte", {}, { prioridade: "CRITICAL" }) },
          { label: "Sem responsável", value: open.filter((t) => !t.assignee).length, tone: open.some((t) => !t.assignee) ? "warning" : "default" },
        ]}
      />
      <SegmentedLinks label="Situação dos chamados" items={[{ k: "open", l: "Em aberto" }, { k: "done", l: "Encerrados" }, { k: "all", l: "Todos" }].map((t) => ({ href: tab(t.k), label: t.l, current: status === t.k }))} />
      <FilterBar action="/app/suporte" hidden={{ status: status === "open" ? undefined : status }} clearHref={tab(status)} active={filtered}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={sp.q} placeholder="Número, título, estação ou unidade" /></FilterField>
        <FilterField label="Prioridade"><Select name="prioridade" defaultValue={sp.prioridade ?? ""}><option value="">Todas</option>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FilterField>
        <FilterField label="Categoria"><Select name="categoria" defaultValue={sp.categoria ?? ""}><option value="">Todas</option>{Object.entries(TICKET_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FilterField>
        <FilterField label="Responsável"><Select name="meus" defaultValue={sp.meus ?? ""}><option value="">Qualquer</option><option value="1">Só os meus</option></Select></FilterField>
      </FilterBar>
      {tickets.length === 0 ? <EmptyState title={filtered ? "Nenhum chamado com esses filtros" : status === "open" ? "Nenhum chamado em aberto" : "Nenhum chamado"} description={filtered ? "Limpe os filtros para ver todos." : "Chamados de motoristas, alertas e da equipe aparecem aqui."} /> : (
        <Card>
          <Table aria-label="Chamados">
            <thead><tr><th>Chamado</th><th className="hidden lg:table-cell">Estação / unidade</th><th>Prioridade</th><th className="hidden md:table-cell">Situação</th><th>Prazo (SLA)</th><th className="hidden md:table-cell">Responsável</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td><Link className="font-medium text-brand-700 hover:underline" href={`/app/suporte/${t.id}`}>{t.number}</Link><p className="max-w-72 truncate text-navy-900">{t.title}</p><p className="text-xs text-navy-400">{TICKET_CATEGORY_LABEL[t.category]} · {ORIGIN_LABEL[t.origin]} · {dateTime(t.createdAt)}</p></td>
                  <td className="hidden text-xs lg:table-cell">{t.station?.ocppIdentity ?? "—"}<p>{t.site?.name}</p></td>
                  <td><Badge tone={t.priority === "CRITICAL" ? "red" : t.priority === "HIGH" ? "amber" : "neutral"}>{PRIORITY_LABEL[t.priority]}</Badge></td>
                  <td className="hidden text-xs md:table-cell">{TICKET_STATUS_LABEL[t.status]}</td>
                  <td className="space-y-1"><SlaBadge label="Resposta" s={t.sla.response} /><br /><SlaBadge label="Solução" s={t.sla.resolution} /></td>
                  <td className="hidden text-xs md:table-cell">{t.assignee?.name ?? <span className="text-amber-700">sem responsável</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
