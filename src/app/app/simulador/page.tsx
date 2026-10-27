import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { getSimulation, listApprovedVersions, listSimulations } from "@/server/modules/commercial/service";
import { normalizeStoredInput } from "@/domain/viability/engine";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { brl, dateTime, num } from "@/lib/format";
import type { ViabilityResult } from "@/domain/viability/engine";
import { AppSimulator } from "./app-simulator";

export const dynamic = "force-dynamic";

export default async function SimuladorAppPage({ searchParams }: { searchParams: Promise<{ leadId?: string; revisar?: string }> }) {
  const ctx = await requirePage("simulation:run");
  const { leadId, revisar } = await searchParams;
  const parentSim = revisar ? await getSimulation(ctx, revisar).catch(() => null) : null;
  const parentInput = parentSim ? normalizeStoredInput(parentSim.inputs) : null;
  const parent = parentSim && parentInput
    ? { id: parentSim.id, name: parentSim.name, versionId: parentSim.modelVersionId ?? undefined, input: parentInput }
    : undefined;
  const [versions, sims] = await Promise.all([listApprovedVersions(ctx), ctx.permissions.has("simulation:read") ? listSimulations(ctx) : []]);
  const models = versions.map((v) => ({ versionId: v.id, status: v.status, terms: v.terms }));

  return (
    <>
      <PageHeader title="Simulador de viabilidade" description="Ao salvar, o servidor recalcula a simulação com os termos da versão registrada no banco e guarda premissas, resultados e versão do motor." />
      {models.length === 0 ? <Alert tone="warning" title="Nenhuma versão de modelo comercial disponível." /> : <>
          {parent && <Alert tone="info" className="mb-4" title={`Revisando “${parent.name}”`}>Ao salvar, a nova simulação fica registrada como revisão, com a lista de premissas alteradas.</Alert>}
          <AppSimulator models={models} leadId={leadId ?? parentSim?.leadId ?? undefined} parent={parent} />
        </>}
      {sims.length > 0 && (
        <Card className="mt-8">
          <CardHeader title="Simulações salvas" description="Projeções — não representam resultados reais." />
          <Table>
            <thead><tr><th>Nome</th><th>Rev.</th><th>Modelo</th><th className="text-right">Investidor/mês (m1)</th><th className="text-right">Payback</th><th>Lead</th><th>Criada</th></tr></thead>
            <tbody>
              {sims.map((s) => {
                const r = s.results as unknown as ViabilityResult;
                return (
                  <tr key={s.id}>
                    <td><Link className="font-medium text-navy-900 hover:text-brand-700" href={`/app/simulador/${s.id}`}>{s.name}</Link></td>
                    <td className="tabular">{s.revision}</td>
                    <td className="text-xs">{s.modelVersion ? `${s.modelVersion.model.name} v${s.modelVersion.version}` : "—"}</td>
                    <td className="tabular text-right">{brl(r.months[0]?.partnerResult)}</td>
                    <td className="tabular text-right">{r.kpis.partnerPaybackMonths === null ? "—" : `${num(r.kpis.partnerPaybackMonths, 1)} m`}</td>
                    <td>{s.leadId ? <Link className="text-brand-700 hover:underline" href={`/app/crm/${s.leadId}`}>abrir</Link> : "—"}</td>
                    <td className="text-xs">{dateTime(s.createdAt)} · {s.engineVersion}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
