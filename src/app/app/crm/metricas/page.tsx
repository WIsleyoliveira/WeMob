import { requirePage } from "@/server/auth/current";
import { crmMetrics } from "@/server/modules/crm/metrics";
import { LEAD_SOURCES } from "@/server/modules/leads/service";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Input } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { brl, date, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MetricasPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const ctx = await requirePage("lead:read");
  const sp = await searchParams;
  const to = sp.ate ? new Date(`${sp.ate}T23:59:59.999-03:00`) : new Date();
  const from = sp.de ? new Date(`${sp.de}T00:00:00-03:00`) : new Date(to.getTime() - 90 * 86400000);
  const m = await crmMetrics(ctx, { from, to });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const src = "CRM (leads, histórico de etapas e propostas)";
  return (
    <>
      <PageHeader title="Métricas comerciais" description={`Período: ${date(m.period.from)} a ${date(m.period.to)}. Cada indicador traz sua fórmula em "Definição e fonte".`} />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="text-sm text-navy-700">De <Input type="date" name="de" defaultValue={iso(from)} className="mt-1 w-40" /></label>
        <label className="text-sm text-navy-700">Até <Input type="date" name="ate" defaultValue={iso(to)} className="mt-1 w-40" /></label>
        <button className={buttonClass({ variant: "secondary" })}>Aplicar</button>
      </form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads criados" value={num(m.leadsCreated)} definition="Leads com data de criação no período." source={src} updatedAt={m.computedAt} />
        <Stat label="Taxa de ganho" value={m.winRate === null ? "—" : pct(m.winRate)} definition="Ganhos ÷ (ganhos + perdidos) entre leads encerrados no período. Sem encerramentos, não é calculada." source={src} updatedAt={m.computedAt} />
        <Stat label="Tempo médio até o ganho" value={m.avgDaysToWin === null ? "—" : `${num(m.avgDaysToWin, 1)} dias`} definition="Média de dias entre a criação do lead e a entrada na etapa de ganho, para leads ganhos no período." source={src} updatedAt={m.computedAt} />
        <Stat label={`Propostas em aberto (${m.openProposals.count})`} value={brl(m.openProposals.total)} definition="Propostas em rascunho ou enviadas hoje; soma do total da última versão de cada uma." source={src} updatedAt={m.computedAt} />
      </div>
      <div className="mt-3">
        <Stat label="Previsão de receita (pipeline ponderado)" tone="projection" value={brl(m.weightedPipeline.value)} definition={`Σ (valor estimado × probabilidade da etapa) dos leads em aberto. Considera ${m.weightedPipeline.leadsWithValue} de ${m.weightedPipeline.openLeads} leads em aberto (os demais não têm valor informado). Estimativa, não receita contratada.`} source={src} updatedAt={m.computedAt} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Conversão entre etapas" description="Dos leads criados no período: alcançaram a etapa seguinte ÷ alcançaram a etapa atual." />
          <Table>
            <thead><tr><th>Etapa</th><th className="text-right">Alcançaram</th><th className="text-right">Conversão p/ próxima</th></tr></thead>
            <tbody>
              {m.reachByStage.map((r, i) => (
                <tr key={r.stageId}><td>{r.name}</td><td className="tabular text-right">{r.reached}</td><td className="tabular text-right">{m.stageConversion[i] ? pct(m.stageConversion[i].rate) : "—"}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Leads por origem" description="Leads criados no período, por canal de entrada." />
          <CardBody>
            {m.leadsBySource.length === 0 ? <p className="text-sm text-navy-500">Sem leads no período.</p> : (
              <ul className="space-y-2">
                {m.leadsBySource.map((s) => (
                  <li key={s.source} className="grid grid-cols-[minmax(8rem,14rem)_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="truncate">{LEAD_SOURCES[s.source as keyof typeof LEAD_SOURCES]}</span>
                    <span className="h-2.5 rounded-full bg-navy-50" aria-hidden><span className="block h-full rounded-full bg-tiffany-500" style={{ width: `${(s.count / m.leadsCreated) * 100}%` }} /></span>
                    <span className="tabular text-right font-semibold">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
