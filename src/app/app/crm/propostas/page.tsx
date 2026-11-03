import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listProposals, PROPOSAL_STATUS_LABEL } from "@/server/modules/crm/proposals";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { brl, date } from "@/lib/format";
import { Select } from "@/components/ui/field";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { hrefWith, param } from "@/lib/query";
import Decimal from "decimal.js";

export const dynamic = "force-dynamic";
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const TONE = { DRAFT: "neutral", SENT: "tiffany", ACCEPTED: "green", REJECTED: "red", CANCELLED: "neutral" } as const;

export default async function PropostasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePage("lead:read");
  const sp = await searchParams;
  const all = await listProposals(ctx);
  const q = param(sp, "q");
  const status = param(sp, "status");
  const now = new Date();
  const proposals = all.filter((p) => (!status || p.status === status) && (!q || norm(`${p.number} ${p.title} ${p.lead.companyName ?? ""} ${p.lead.contactName}`).includes(norm(q))));
  const sum = (xs: typeof all) => xs.reduce((a, p) => a.plus(p.versions[0]?.total.toString() ?? 0), new Decimal(0)).toFixed(2);
  const sent = all.filter((p) => p.status === "SENT");
  const expired = sent.filter((p) => p.versions[0] && p.versions[0].validUntil < now);
  return (
    <>
      <PageHeader title="Propostas comerciais" description="Cada revisão gera uma versão imutável. Crie propostas a partir da página do lead." />
      {all.length > 0 && (
        <>
          <SummaryStrip
            label="Resumo das propostas"
            items={[
              { label: "Em negociação", value: sent.length, hint: brl(sum(sent)), href: hrefWith("/app/crm/propostas", {}, { status: "SENT" }), current: status === "SENT" && !q },
              { label: "Aceitas", value: all.filter((p) => p.status === "ACCEPTED").length, hint: brl(sum(all.filter((p) => p.status === "ACCEPTED"))), tone: "success", href: hrefWith("/app/crm/propostas", {}, { status: "ACCEPTED" }), current: status === "ACCEPTED" && !q },
              { label: "Rascunhos", value: all.filter((p) => p.status === "DRAFT").length, href: hrefWith("/app/crm/propostas", {}, { status: "DRAFT" }), current: status === "DRAFT" && !q },
              { label: "Enviadas vencidas", value: expired.length, tone: expired.length ? "warning" : "default", hint: "validade passou" },
            ]}
          />
          <FilterBar action="/app/crm/propostas" clearHref="/app/crm/propostas" active={!!(q || status)}>
            <FilterField label="Buscar" wide><SearchInput defaultValue={q} placeholder="Número, título ou lead" /></FilterField>
            <FilterField label="Situação"><Select name="status" defaultValue={status ?? ""}><option value="">Todas</option>{Object.entries(PROPOSAL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FilterField>
          </FilterBar>
        </>
      )}
      {all.length === 0 ? <EmptyState title="Nenhuma proposta" description="Abra um lead e use 'Nova proposta'." /> : proposals.length === 0 ? <EmptyState title="Nenhuma proposta com esses filtros" description="Limpe os filtros para ver todas." /> : (
        <Card>
          <Table aria-label="Propostas">
            <thead><tr><th>Número</th><th>Título</th><th className="hidden md:table-cell">Lead</th><th className="text-right">Total (última versão)</th><th className="hidden md:table-cell">Validade</th><th>Situação</th></tr></thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/crm/propostas/${p.id}`} className="font-medium text-navy-900 hover:text-brand-700">{p.number}</Link></td>
                  <td>{p.title} <span className="text-xs text-navy-500">v{p.versions[0]?.version}</span></td>
                  <td className="hidden md:table-cell"><Link href={`/app/crm/${p.lead.id}`} className="text-brand-700 hover:underline">{p.lead.companyName ?? p.lead.contactName}</Link></td>
                  <td className="tabular text-right">{brl(p.versions[0]?.total.toString())}</td>
                  <td className="hidden text-xs md:table-cell">{p.versions[0] ? <span className={p.status === "SENT" && p.versions[0].validUntil < now ? "font-medium text-amber-700" : undefined}>{date(p.versions[0].validUntil)}{p.status === "SENT" && p.versions[0].validUntil < now ? " (vencida)" : ""}</span> : "—"}</td>
                  <td><Badge tone={TONE[p.status]}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
