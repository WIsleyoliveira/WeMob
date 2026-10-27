import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { CONTRACT_STATUS_LABEL, listContracts } from "@/server/modules/contracts/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { date, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContratosPage() {
  const ctx = await requirePage("contract:read");
  const contracts = await listContracts(ctx);
  return (
    <>
      <PageHeader
        title="Contratos"
        description="Contratos com parceiros e investidores. Condições em versões imutáveis (original e aditivos), cada uma aprovada por pessoa diferente de quem a criou."
        actions={ctx.permissions.has("contract:write") && <Link href="/app/contratos/novo" className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Novo contrato</Link>}
      />
      {contracts.length === 0 ? <EmptyState title="Nenhum contrato cadastrado" description="Vincule a unidade ao parceiro no cadastro da unidade e depois crie o contrato." /> : (
        <Card>
          <Table>
            <thead><tr><th>Número</th><th>Parceiro</th><th>Unidades</th><th>Status</th><th>Condição vigente</th><th>Pendências</th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium text-brand-700 hover:underline" href={`/app/contratos/${c.id}`}>{c.number}</Link><p className="text-xs text-navy-400">{c.title}</p></td>
                  <td>{c.partnerOrganization.name}</td>
                  <td className="text-xs">{c.sites.map((s) => s.site.name).join(", ")}</td>
                  <td><Badge tone={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "neutral"}>{CONTRACT_STATUS_LABEL[c.status]}</Badge></td>
                  <td className="text-xs">{c.current ? <>v{c.current.version} desde {date(c.current.effectiveFrom)} · parceiro {pct(c.current.partnerShareRate.toString())} · royalty {pct(c.current.royaltyRate.toString())}</> : "Nenhuma versão aprovada vigente"}</td>
                  <td className="text-xs">{c.pending ? <Badge tone="amber">v{c.pending.version} aguardando aprovação</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
