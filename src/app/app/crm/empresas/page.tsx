import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listCompanies } from "@/server/modules/crm/details";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";

export const dynamic = "force-dynamic";

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePage("lead:read");
  const { q } = await searchParams;
  const companies = await listCompanies(ctx, q);
  return (
    <>
      <PageHeader title="Empresas" description="Postos, supermercados, estacionamentos e demais estabelecimentos. Criadas ao vincular um lead; deduplicadas por CNPJ/CPF ou nome." />
      <FilterBar action="/app/crm/empresas" clearHref="/app/crm/empresas" active={!!q}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={q} placeholder="Nome ou CNPJ/CPF" /></FilterField>
      </FilterBar>
      {companies.length === 0 ? <EmptyState title={q ? "Nenhuma empresa com essa busca" : "Nenhuma empresa"} description={q ? "Tente outro nome ou limpe a busca." : "Vincule um lead a uma empresa na página do lead."} /> : (
        <Card>
          <Table aria-label="Empresas">
            <thead><tr><th>Empresa</th><th className="hidden md:table-cell">Documento</th><th className="hidden sm:table-cell">Local</th><th className="text-right">Contatos</th><th className="text-right">Leads</th><th>Situação</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium text-navy-900 hover:text-brand-700" href={`/app/crm/empresas/${c.id}`}>{c.name}</Link></td>
                  <td className="hidden tabular text-xs md:table-cell">{c.document ?? "—"}</td>
                  <td className="hidden sm:table-cell">{c.city ? `${c.city}/${c.state ?? ""}` : "—"}</td>
                  <td className="tabular text-right">{c._count.contacts}</td>
                  <td className="tabular text-right">{c._count.leads}</td>
                  <td>{c.convertedOrganization ? <Badge tone="green">{c.convertedOrganization.kind === "PARTNER" ? "Parceiro" : "Investidor"}</Badge> : <Badge>Prospect</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
