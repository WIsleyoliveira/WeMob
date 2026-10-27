import { requirePage } from "@/server/auth/current";
import { listSites } from "@/server/modules/sites/service";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
const STATUS = { PROSPECT: "Prospecção", IMPLEMENTATION: "Implantação", OPERATING: "Em operação", SUSPENDED: "Suspensa" } as const;

export default async function UnidadesPage() {
  const ctx = await requirePage("site:read");
  const sites = await listSites(ctx);
  return (
    <>
      <PageHeader
        title="Unidades"
        description={ctx.orgKind === "OPERATOR" ? "Eletropostos da rede." : "Unidades vinculadas à sua organização. Você vê somente os dados permitidos pelo seu contrato."}
      />
      {sites.length === 0 ? (
        <EmptyState
          title="Nenhuma unidade cadastrada"
          description="O cadastro completo de unidades, carregadores, conectores e telemetria faz parte da Fase 4 (núcleo operacional). Unidades aparecerão aqui assim que forem registradas."
        />
      ) : (
        <Card>
          <Table>
            <thead><tr><th>Unidade</th><th>Local</th><th>Status</th><th>Investidor / parceiro</th></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name} {s.isDemo && <Badge tone="amber">demonstração</Badge>}</td>
                  <td>{s.city ? `${s.city}/${s.state ?? ""}` : "—"}</td>
                  <td><Badge tone={s.status === "OPERATING" ? "green" : "neutral"}>{STATUS[s.status]}</Badge></td>
                  <td>{s.partnerOrganization?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
