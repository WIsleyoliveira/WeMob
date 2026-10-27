import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listSites } from "@/server/modules/sites/service";
import { listPartnerOrgs } from "@/server/modules/stations/service";
import { createSiteAction } from "@/app/actions/stations";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StateMessage } from "@/components/ui/state";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/app/action-form";
import { SiteFields } from "./site-fields";

export const dynamic = "force-dynamic";
const STATUS = { PROSPECT: "Prospecção", IMPLEMENTATION: "Implantação", OPERATING: "Em operação", SUSPENDED: "Suspensa" } as const;

export default async function UnidadesPage() {
  const ctx = await requirePage("site:read");
  const sites = await listSites(ctx);
  const canWrite = ctx.permissions.has("site:write") && ctx.orgKind === "OPERATOR";
  const partners = canWrite ? await listPartnerOrgs(ctx) : [];
  return (
    <>
      <PageHeader
        title="Unidades"
        description={ctx.orgKind === "OPERATOR" ? "Eletropostos da rede: endereço, horários, estações, conectores e tarifas." : "Unidades vinculadas à sua organização. Você vê somente os dados permitidos pelo seu contrato."}
      />
      <StateMessage kind="unavailable" className="mb-6 py-6" title="Mapa não configurado" description="Nenhum serviço de mapas foi contratado/configurado. As coordenadas ficam registradas e são exibidas em lista." />
      {sites.length === 0 ? (
        <EmptyState title="Nenhuma unidade cadastrada" description={canWrite ? "Cadastre a primeira unidade abaixo." : undefined} />
      ) : (
        <Card>
          <Table>
            <thead><tr><th>Unidade</th><th>Local</th><th>Coordenadas</th><th>Status</th><th className="text-right">Estações</th><th>Investidor / parceiro</th></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/app/unidades/${s.id}`} className="font-medium text-navy-900 hover:text-brand-700">{s.name}</Link> {s.isDemo && <Badge tone="amber">demonstração</Badge>} {s.isPublic && <Badge tone="tiffany">pública</Badge>}</td>
                  <td>{s.city ? `${s.city}/${s.state ?? ""}` : "—"}</td>
                  <td className="tabular text-xs">{s.latitude && s.longitude ? `${s.latitude}, ${s.longitude}` : "—"}</td>
                  <td><Badge tone={s.status === "OPERATING" ? "green" : "neutral"}>{STATUS[s.status]}</Badge></td>
                  <td className="tabular text-right">{s._count.stations}</td>
                  <td>{s.partnerOrganization?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {canWrite && (
        <Card className="mt-6 max-w-3xl">
          <CardHeader title="Nova unidade" />
          <CardBody>
            <ActionForm action={createSiteAction} submitLabel="Cadastrar unidade">
              <SiteFields partners={partners} />
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </>
  );
}
