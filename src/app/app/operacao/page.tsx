import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { operationalOverview } from "@/server/modules/stations/service";
import { STATUS_LABEL, type ConnectorStatus } from "@/domain/stations/status";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConnectorStatusBadge, EnvironmentBadge } from "@/components/app/station-badges";
import { date, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OperacaoPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; incluir?: string }> }) {
  const ctx = await requirePage("site:read");
  const sp = await searchParams;
  const to = sp.ate ? new Date(`${sp.ate}T23:59:59.999-03:00`) : new Date();
  const from = sp.de ? new Date(`${sp.de}T00:00:00-03:00`) : new Date(to.getTime() - 7 * 86400000);
  const include = sp.incluir === "1";
  const o = await operationalOverview(ctx, { from, to, includeNonProduction: include });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const src = `Telemetria OCPP · ${include ? "produção + teste + simulado" : "somente produção"}`;
  return (
    <>
      <PageHeader title="Operação da rede" description={`Período: ${date(from)} a ${date(to)}. Status atual usa só evidência recente; sem comunicação = desconhecido.`} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-navy-700">De <Input type="date" name="de" defaultValue={iso(from)} className="mt-1 w-40" /></label>
        <label className="text-sm text-navy-700">Até <Input type="date" name="ate" defaultValue={iso(to)} className="mt-1 w-40" /></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-navy-700"><input type="checkbox" name="incluir" value="1" defaultChecked={include} className="size-4 accent-brand-600" /> Incluir estações simuladas e de teste</label>
        <button className={buttonClass({ variant: "secondary" })}>Aplicar</button>
      </form>
      {include && <Alert tone="warning" className="mb-4" title="Dados simulados/teste incluídos">Os indicadores abaixo misturam estações não produtivas e não representam operação real.</Alert>}
      {o.stations.total === 0 ? (
        <EmptyState title={include ? "Nenhuma estação cadastrada" : "Nenhuma estação de produção"} description={include ? "Cadastre estações em Unidades." : <>Não há equipamentos reais integrados. <Link className="underline" href="/app/operacao?incluir=1">Ver estações simuladas/teste</Link>.</>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Estações comunicando" value={`${o.stations.communicating} de ${o.stations.total}`} definition="Estações com mensagem recebida há no máximo 2 × intervalo de heartbeat + 60 s (relógio do servidor)." source={src} updatedAt={o.computedAt} />
            <Stat label="Sessões concluídas" value={num(o.sessions.completed)} definition="Sessões iniciadas no período e encerradas com StopTransaction, excluindo recusadas por autorização." source={src} updatedAt={o.computedAt} />
            <Stat label="Energia entregue" value={`${num(o.sessions.energyKwhCompleted, 1)} kWh`} definition="Σ (medidor final − medidor inicial) das sessões concluídas no período." source={src} updatedAt={o.computedAt} />
            <Stat label="Sessões sem comunicação" value={num(o.sessions.communicationLost)} definition="Sessões cujo carregador parou de comunicar; valores parciais até chegar o StopTransaction." source={src} updatedAt={o.computedAt} />
          </div>
          {o.alerts.length > 0 && (
            <Alert tone="danger" className="mt-4" title={`Alertas (${o.alerts.length})`}>
              <ul className="list-disc pl-5">{o.alerts.map((a, i) => <li key={i}>{a.text}</li>)}</ul>
            </Alert>
          )}
          <Card className="mt-6">
            <CardHeader title="Conectores" description="Utilização = tempo ocupado ÷ período. Disponibilidade = tempo fora de falha/indisponível/desconhecido ÷ período. Tempo sem evidência conta como desconhecido." />
            <Table>
              <thead><tr><th>Estação</th><th>Unidade</th><th>Conector</th><th>Status atual</th><th className="text-right">Utilização</th><th className="text-right">Disponibilidade</th><th className="text-right">Sem evidência</th></tr></thead>
              <tbody>
                {o.perConnector.map((c) => (
                  <tr key={`${c.stationId}-${c.connectorId}`}>
                    <td><Link className="text-brand-700 hover:underline" href={`/app/estacoes/${c.stationId}`}>{c.identity}</Link> {c.environment !== "PRODUCTION" && <EnvironmentBadge env={c.environment} />}</td>
                    <td>{c.site}</td>
                    <td>{c.connectorId}</td>
                    <td><ConnectorStatusBadge status={c.status as ConnectorStatus} /></td>
                    <td className="tabular text-right">{pct(c.utilization)}</td>
                    <td className="tabular text-right">{pct(c.availability)}</td>
                    <td className="tabular text-right">{pct(c.unknownShare)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="px-5 py-3 text-xs text-navy-500">Contagem atual: {Object.entries(o.statusCounts).map(([k, v]) => `${STATUS_LABEL[k as ConnectorStatus]}: ${v}`).join(" · ") || "—"}</p>
          </Card>
        </>
      )}
    </>
  );
}
