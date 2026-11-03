import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { CONTRACT_STATUS_LABEL, listContracts } from "@/server/modules/contracts/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { date } from "@/lib/format";
import { describeTerms } from "@/domain/finance/contracts";
import { Select } from "@/components/ui/field";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { hrefWith, param } from "@/lib/query";

export const dynamic = "force-dynamic";

const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default async function ContratosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePage("contract:read");
  const sp = await searchParams;
  const all = await listContracts(ctx);
  const q = param(sp, "q");
  const status = param(sp, "status");
  const modelo = param(sp, "modelo");
  const pendente = param(sp, "pendente") === "1";
  const contracts = all.filter(
    (c) =>
      (!q || norm(`${c.number} ${c.title} ${c.partnerOrganization.name} ${c.sites.map((s) => s.site.name).join(" ")}`).includes(norm(q))) &&
      (!status || c.status === status) &&
      (!modelo || (modelo === "participacao" ? c.current?.revenueShareRate != null : c.current != null && c.current.revenueShareRate == null)) &&
      (!pendente || !!c.pending),
  );
  const filtered = !!(q || status || modelo || pendente);
  const now = new Date();
  // Aprovada com vigência futura: não é "sem versão" — é condição já decidida que ainda vai começar.
  const upcoming = (c: (typeof all)[number]) => c.versions.filter((v) => v.status === "APPROVED" && v.effectiveFrom > now).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0] ?? null;
  const noVersion = all.filter((c) => !c.current && !upcoming(c));
  return (
    <>
      <PageHeader
        title="Contratos"
        description="Contratos com parceiros e investidores. Condições em versões imutáveis (original e aditivos), cada uma aprovada por pessoa diferente de quem a criou."
        actions={ctx.permissions.has("contract:write") && <Link href="/app/contratos/novo" className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Novo contrato</Link>}
      />
      {all.length > 0 && (
        <SummaryStrip
          label="Resumo dos contratos"
          items={[
            { label: "Ativos", value: all.filter((c) => c.status === "ACTIVE").length, href: hrefWith("/app/contratos", {}, { status: "ACTIVE" }), current: status === "ACTIVE" && !q && !modelo && !pendente },
            { label: "Aguardando aprovação", value: all.filter((c) => c.pending).length, tone: all.some((c) => c.pending) ? "warning" : "default", hint: "por outra pessoa", href: hrefWith("/app/contratos", {}, { pendente: "1" }), current: pendente && !q && !status && !modelo },
            { label: "Participação 30/70", value: all.filter((c) => c.current?.revenueShareRate != null).length, href: hrefWith("/app/contratos", {}, { modelo: "participacao" }), current: modelo === "participacao" && !q && !status && !pendente },
            { label: "Modelo antigo", value: all.filter((c) => c.current && c.current.revenueShareRate == null).length, hint: "condições preservadas", href: hrefWith("/app/contratos", {}, { modelo: "antigo" }), current: modelo === "antigo" && !q && !status && !pendente },
            { label: "Vigência futura", value: all.filter((c) => !c.current && upcoming(c)).length, hint: "aprovados, ainda não começaram" },
            { label: "Sem versão aprovada", value: noVersion.length, tone: noVersion.some((c) => c.status !== "TERMINATED" && c.status !== "DRAFT") ? "danger" : "default" },
          ]}
        />
      )}
      {all.length > 0 && (
        <FilterBar action="/app/contratos" clearHref="/app/contratos" active={filtered}>
          <FilterField label="Buscar" wide><SearchInput defaultValue={q} placeholder="Número, título, parceiro ou unidade" /></FilterField>
          <FilterField label="Situação"><Select name="status" defaultValue={status ?? ""}><option value="">Todas</option>{Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FilterField>
          <FilterField label="Modelo vigente"><Select name="modelo" defaultValue={modelo ?? ""}><option value="">Todos</option><option value="participacao">Participação 30/70</option><option value="antigo">Modelo antigo</option></Select></FilterField>
          <FilterField label="Pendências"><Select name="pendente" defaultValue={pendente ? "1" : ""}><option value="">Todas</option><option value="1">Aguardando aprovação</option></Select></FilterField>
        </FilterBar>
      )}
      {all.length === 0 ? <EmptyState title="Nenhum contrato cadastrado" description="Vincule a unidade ao parceiro no cadastro da unidade e depois crie o contrato." /> : contracts.length === 0 ? <EmptyState title="Nenhum contrato com esses filtros" description="Limpe os filtros para ver todos." /> : (
        <Card>
          <Table aria-label="Contratos">
            <thead><tr><th>Número</th><th>Parceiro</th><th className="hidden lg:table-cell">Unidades</th><th>Situação</th><th className="hidden md:table-cell">Condição vigente</th><th>Pendências</th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium text-brand-700 hover:underline" href={`/app/contratos/${c.id}`}>{c.number}</Link><p className="text-xs text-navy-400">{c.title}</p></td>
                  <td>{c.partnerOrganization.name}</td>
                  <td className="hidden text-xs lg:table-cell">{c.sites.map((s) => s.site.name).join(", ")}</td>
                  <td><Badge tone={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "neutral"}>{CONTRACT_STATUS_LABEL[c.status]}</Badge></td>
                  <td className="hidden text-xs md:table-cell">{c.current ? <>v{c.current.version} desde {date(c.current.effectiveFrom)} · {describeTerms(c.current)}</> : upcoming(c) ? <>v{upcoming(c)!.version} aprovada · <b>vale a partir de {date(upcoming(c)!.effectiveFrom)}</b> · {describeTerms(upcoming(c)!)}</> : <span className="text-amber-700">Nenhuma versão aprovada</span>}</td>
                  <td className="text-xs">{c.pending ? <Link href={`/app/contratos/${c.id}#versao-${c.pending.id}`}><Badge tone="amber">v{c.pending.version} aguardando aprovação</Badge></Link> : <span className="text-navy-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
