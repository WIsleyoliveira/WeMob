import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getCompany } from "@/server/modules/crm/details";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("lead:read");
  const c = await getCompany(ctx, (await params).id).catch(() => notFound());
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "CRM", href: "/app/crm" }, { label: "Empresas", href: "/app/crm/empresas" }, { label: c.name }]}
        title={c.name}
        description={`${c.document ? `Documento ${c.document} · ` : ""}${c.city ? `${c.city}/${c.state ?? ""}` : "Local não informado"}${c.convertedOrganization ? ` · convertida em ${c.convertedOrganization.name}` : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Contatos" />
          <Table>
            <thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th></tr></thead>
            <tbody>{c.contacts.map((ct) => <tr key={ct.id}><td>{ct.name}</td><td>{ct.email ?? "—"}</td><td>{ct.phone ?? "—"}</td></tr>)}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Leads" />
          <Table>
            <thead><tr><th>Lead</th><th>Etapa</th></tr></thead>
            <tbody>{c.leads.map((l) => <tr key={l.id}><td><Link className="text-brand-700 hover:underline" href={`/app/crm/${l.id}`}>{l.contactName}</Link></td><td><Badge>{l.stage.name}</Badge></td></tr>)}</tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
