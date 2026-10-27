import { requirePage } from "@/server/auth/current";
import { opsPanel } from "@/server/modules/support/panel";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Select } from "@/components/ui/field";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ dias?: string; todos?: string }> }) {
  const ctx = await requirePage("support:read");
  const sp = await searchParams;
  const days = [1, 7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const includeNonProduction = sp.todos === "1";
  const p = await opsPanel(ctx, { from, to, includeNonProduction });
  const src = "Status OCPP, tickets e ordens de serviço";
  return (
    <>
      <PageHeader title="Painel operacional" description={`Últimos ${days} dia(s). ${includeNonProduction ? "Inclui estações de TESTE/SIMULAÇÃO." : "Somente estações de produção."}`} />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-navy-700">Período <Select name="dias" defaultValue={String(days)} className="mt-1 w-36"><option value="1">24 horas</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></Select></label>
        <label className="flex h-10 items-center gap-2 text-sm text-navy-700"><input type="checkbox" name="todos" value="1" defaultChecked={includeNonProduction} /> Incluir teste/simulação</label>
        <button className="h-10 rounded-lg border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">Atualizar</button>
      </form>
      {includeNonProduction && <Alert tone="warning" className="mb-6">Dados de teste/simulação incluídos: não use estes números como indicadores da rede.</Alert>}
      {p.connectors === 0 && <Alert tone="info" className="mb-6">Nenhum conector no escopo: disponibilidade e indisponibilidade não podem ser calculadas.</Alert>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Disponibilidade" value={p.availability === null ? "—" : pct(p.availability)} definition="Média, por conector, do tempo fora de Indisponível / Em falha / Sem comunicação ÷ duração do período. Sem evidência de status conta como indisponível." source={src} updatedAt={p.computedAt} />
        <Stat label="Indisponibilidade" value={`${num(p.downtimeHours, 1)} h`} definition="Σ por conector de (1 − disponibilidade) × horas do período." source={src} updatedAt={p.computedAt} />
        <Stat label="MTTR" value={p.mttrHours === null ? "—" : `${num(p.mttrHours, 1)} h`} definition={`Média de (resolvido em − aberto em), relógio corrido, dos ${p.repairTickets} ticket(s) de falha/conectividade resolvidos no período.`} source={src} updatedAt={p.computedAt} />
        <Stat label="Cumprimento de SLA (solução)" value={p.slaCompliance === null ? "—" : pct(p.slaCompliance)} definition={`${p.slaMet} de ${p.slaResolvedWithTarget} tickets resolvidos no período dentro do prazo de solução (tempo de SLA no calendário da política, descontadas pausas).`} source={src} updatedAt={p.computedAt} />
        <Stat label="Cumprimento de SLA (1ª resposta)" value={p.responseCompliance === null ? "—" : pct(p.responseCompliance)} definition="Tickets resolvidos no período cuja 1ª resposta (comentário ou mudança de status) ocorreu dentro do prazo ÷ tickets com prazo de resposta." source={src} updatedAt={p.computedAt} />
        <Stat label="Tickets em aberto" value={num(p.openTickets)} definition="Tickets abertos, em atendimento ou aguardando (agora)." source="Tickets" updatedAt={p.computedAt} />
        <Stat label="Alertas não resolvidos" value={`${p.openAlerts.CRITICAL ?? 0} críticos · ${p.openAlerts.WARNING ?? 0} atenção`} definition="Alertas abertos ou reconhecidos e ainda não resolvidos (agora)." source="Motor de alertas" updatedAt={p.computedAt} />
        <Stat label="OS concluídas" value={num(p.completedWorkOrders)} definition="Ordens de serviço concluídas no período." source="Manutenção" updatedAt={p.computedAt} />
      </div>
      {p.perConnector.length > 0 && (
        <Card>
          <Table>
            <thead><tr><th>Estação</th><th>Unidade</th><th>Conector</th><th>Ambiente</th><th className="text-right">Disponibilidade</th><th className="text-right">Sem evidência</th><th className="text-right">Utilização</th></tr></thead>
            <tbody>{p.perConnector.map((c) => <tr key={`${c.stationId}-${c.connectorId}`}><td>{c.identity}</td><td>{c.site}</td><td>{c.connectorId}</td><td className="text-xs">{c.environment}</td><td className="tabular text-right">{pct(c.availability)}</td><td className="tabular text-right">{pct(c.unknownShare)}</td><td className="tabular text-right">{pct(c.utilization)}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
