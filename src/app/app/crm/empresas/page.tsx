import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listCompanies } from "@/server/modules/crm/details";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePage("lead:read");
  const { q } = await searchParams;
  const companies = await listCompanies(ctx, q);
  return (
    <>
      <PageHeader title="Empresas" description="Postos, supermercados, estacionamentos e demais estabelecimentos. Criadas ao vincular um lead; deduplicadas por CNPJ/CPF ou nome." />
      <form method="get" className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome" className="w-72" aria-label="Buscar empresa" />
        <button className={buttonClass({ variant: "secondary" })}>Buscar</button>
      </form>
      {companies.length === 0 ? <EmptyState title="Nenhuma empresa" description="Vincule um lead a uma empresa na página do lead." /> : (
        <Card>
          <Table>
            <thead><tr><th>Empresa</th><th>Documento</th><th>Local</th><th className="text-right">Contatos</th><th className="text-right">Leads</th><th>Situação</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium text-navy-900 hover:text-brand-700" href={`/app/crm/empresas/${c.id}`}>{c.name}</Link></td>
                  <td className="tabular text-xs">{c.document ?? "—"}</td>
                  <td>{c.city ? `${c.city}/${c.state ?? ""}` : "—"}</td>
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
