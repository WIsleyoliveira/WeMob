import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { pipelineSummary } from "@/server/modules/leads/service";
import { listSites } from "@/server/modules/sites/service";
import { listSimulations } from "@/server/modules/commercial/service";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { brl, dateTime, num, pct } from "@/lib/format";
import { operationalOverview } from "@/server/modules/stations/service";
import { networkUsage } from "@/server/modules/usage/service";
import { paymentsOverview } from "@/server/payments/service";
import { BarChart } from "@/components/ui/bar-chart";
import { STATUS_LABEL, type ConnectorStatus } from "@/domain/stations/status";
import { periodRange, type UsagePeriod } from "@/domain/usage/series";
import { cn } from "@/lib/cn";

const PERIODS: Record<string, string> = { "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" };
const kwhFmt = (v: number) => `${num(v, v < 10 ? 2 : 1)} kWh`;

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePage();
  const params = await searchParams;
  const periodKey = typeof params.periodo === "string" && params.periodo in PERIODS ? params.periodo : "30";
  const includeTest = params.dados === "teste";
  const { from, to } = periodRange(periodKey as UsagePeriod);
  const canOps = ctx.permissions.has("site:read");
  const canPay = ctx.permissions.has("payment:read") && ctx.orgKind === "OPERATOR";
  const [funnel, sites, sims, ops, usage, pay] = await Promise.all([
    ctx.permissions.has("lead:read") ? pipelineSummary(ctx) : null,
    canOps ? listSites(ctx) : null,
    ctx.permissions.has("simulation:read") ? listSimulations(ctx) : null,
    canOps ? operationalOverview(ctx, { from, to, includeNonProduction: includeTest }) : null,
    canOps ? networkUsage(ctx, { from, to, includeNonProduction: includeTest }) : null,
    canPay ? paymentsOverview(ctx) : null,
  ]);
  const now = new Date();
  const periodLabel = PERIODS[periodKey].toLowerCase();
  const envLabel = includeTest ? "produção + teste/simulação" : "somente produção";
  const href = (p: string, t = includeTest) => `/app?periodo=${p}${t ? "&dados=teste" : ""}`;
  const pendingNow = pay ? pay.byStatus.filter((b) => ["PENDING", "AUTHORIZED"].includes(b.status) && (includeTest || b.environment === "PRODUCTION")).reduce((a, b) => a + b._count, 0) : 0;
  const bucket = usage?.granularity === "day" ? "por dia" : usage?.granularity === "week" ? "por semana" : "por mês";

  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} description="Indicadores calculados somente a partir de dados registrados na plataforma." />

      {funnel && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-navy-400">Comercial</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Leads em aberto" value={num(funnel.open)} definition="Leads que não estão em etapa de ganho ou perda." source="CRM (tabela Lead)" updatedAt={funnel.computedAt} />
            <Stat label="Novos leads (30 dias)" value={num(funnel.newLast30Days)} definition="Leads criados nos últimos 30 dias, de qualquer origem." source="CRM (Lead.createdAt)" updatedAt={funnel.computedAt} />
            <Stat label="Oportunidades paradas" value={num(funnel.stale)} definition="Leads em aberto sem mudança de etapa há mais de 7 dias." source="CRM (Lead.stageChangedAt)" updatedAt={funnel.computedAt} />
            <Stat label="Taxa de conversão" value={funnel.conversionRate === null ? "—" : pct(funnel.conversionRate)} definition="Ganhos ÷ (ganhos + perdidos). Sem negócios encerrados, não é calculada." source="CRM (etapas de ganho/perda)" updatedAt={funnel.computedAt} />
          </div>
          <Card className="mt-4">
            <CardHeader
              title="Leads por etapa do funil"
              description={`Quantidade atual de leads (unidade: leads) em cada etapa · todos os períodos · fonte: CRM · ${dateTime(funnel.computedAt)}`}
              actions={<Link href="/app/crm" className="text-sm font-medium text-brand-700 hover:underline">Abrir CRM →</Link>}
            />
            <CardBody>
              {funnel.total === 0 ? (
                <p className="text-sm text-navy-500">Nenhum lead registrado ainda.</p>
              ) : (
                <ul className="space-y-2.5">
                  {funnel.stages.map((s) => {
                    const max = Math.max(...funnel.stages.map((x) => x.count), 1);
                    return (
                      <li key={s.id}>
                        <Link href={`/app/crm?stageId=${s.id}&view=lista`} className="group grid grid-cols-[minmax(7rem,10rem)_1fr_3rem] items-center gap-3 text-sm">
                          <span className="truncate text-navy-700 group-hover:text-navy-900">{s.name}</span>
                          <span className="h-2.5 rounded-full bg-navy-50" aria-hidden>
                            <span className={`block h-full rounded-full ${s.isLost ? "bg-navy-300" : s.isWon ? "bg-brand-600" : "bg-tiffany-500"}`} style={{ width: `${(s.count / max) * 100}%` }} />
                          </span>
                          <span className="tabular text-right font-semibold text-navy-900">{s.count}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>
      )}

      {ops && usage && (
        <section className="mb-8" aria-labelledby="op-titulo">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="op-titulo" className="font-display text-sm font-semibold uppercase tracking-wide text-navy-400">Operação da rede · {periodLabel} · {envLabel}</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              {Object.entries(PERIODS).map(([k, l]) => (
                <Link key={k} href={href(k)} aria-current={periodKey === k ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 font-medium", periodKey === k ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-700 hover:border-navy-300")}>{l}</Link>
              ))}
              <Link href={href(periodKey, !includeTest)} className="rounded-full border border-dashed border-navy-300 px-3 py-1.5 font-medium text-navy-700">{includeTest ? "Só produção" : "Incluir teste/simulação"}</Link>
            </div>
          </div>
          {includeTest && <Alert tone="warning" className="mb-3" title="Dados de teste e simulação incluídos">Esses números misturam estações de produção com estações de teste/simuladas e não representam receita real.</Alert>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Estações com comunicação" value={`${num(ops.stations.communicating)} de ${num(ops.stations.total)}`} definition="Estações que se comunicaram recentemente. Sem comunicação, a disponibilidade é desconhecida." source="OCPP (último contato)" updatedAt={ops.computedAt} />
            <Stat label="Sessões em andamento" value={num(ops.sessions.active)} definition={`Sessões ativas iniciadas no período. Sem comunicação: ${ops.sessions.communicationLost}.`} source="OCPP (ChargingSession)" updatedAt={ops.computedAt} />
            <Stat label="Recargas concluídas" value={num(usage.totals.sessions)} definition={`Concluídas no período. Iniciadas: ${ops.sessions.started}; recusadas na autorização: ${ops.sessions.rejected}.`} source="OCPP (ChargingSession)" updatedAt={now} />
            <Stat label="Taxa de conclusão" value={ops.sessions.started ? pct(usage.totals.sessions / ops.sessions.started) : "—"} definition="Concluídas ÷ iniciadas no período. Sem sessões, não é calculada." source="OCPP" updatedAt={now} />
            <Stat label="Energia entregue" value={kwhFmt(usage.totals.kwh)} definition="Soma da energia medida nas recargas concluídas do período." source="Medidor do carregador" updatedAt={now} />
            {canPay && <Stat label="Valor recebido" value={brl(usage.totals.paid)} definition="Capturado − estornado, confirmado pelo gateway, nas recargas concluídas do período. Não inclui pagamentos pendentes nem é receita contábil." source="Gateway de pagamento" updatedAt={now} />}
            {canPay && <Stat label="Pagamentos aguardando" value={num(pendingNow)} definition="Pagamentos pendentes ou só reservados agora (todos os períodos). Não contam como recebidos." source="Gateway de pagamento" updatedAt={now} />}
            {pay && <Stat label="Em análise financeira" value={num(pay.review)} definition={`Pagamentos com análise aberta. Estornos aguardando o gateway: ${pay.refundsPending}.`} source="Pagamentos" updatedAt={now} />}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <BarChart title="Energia entregue" unit={`kWh ${bucket}`} period={`${periodLabel} · ${envLabel}`} data={usage.series.map((p) => ({ key: p.key, label: p.label, value: p.kwh }))} format={kwhFmt} emptyText="Nenhuma recarga concluída no período. Quando houver, a energia de cada dia aparece aqui." />
            <BarChart title="Recargas concluídas" unit={`quantidade ${bucket}`} period={`${periodLabel} · ${envLabel}`} tone="tiffany" data={usage.series.map((p) => ({ key: p.key, label: p.label, value: p.sessions }))} format={(v) => num(v)} emptyText="Nenhuma recarga concluída no período." />
            {canPay && <BarChart title="Valor recebido (confirmado)" unit={`R$ ${bucket}`} period={`${periodLabel} · ${envLabel}`} tone="navy" data={usage.series.map((p) => ({ key: p.key, label: p.label, value: Number(p.paid) }))} format={(v) => brl(v)} emptyText="Nenhum pagamento confirmado no período." />}
            <Card>
              <CardHeader title="Situação dos conectores agora" description={`Estado efetivo (sem comunicação = desconhecido) · ${dateTime(ops.computedAt)}`} actions={<Link href="/app/operacao" className="text-sm font-medium text-brand-700 hover:underline">Abrir operação →</Link>} />
              <CardBody>
                {Object.keys(ops.statusCounts).length === 0 ? (
                  <p className="text-sm text-navy-500">Nenhum conector cadastrado neste escopo.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(ops.statusCounts).map(([st, n]) => (
                      <li key={st} className="flex justify-between rounded-lg bg-navy-50 px-3 py-2"><span className="text-navy-700">{STATUS_LABEL[st as ConnectorStatus] ?? st}</span><b className="tabular">{n}</b></li>
                    ))}
                  </ul>
                )}
                {usage.bySite.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-navy-400">Energia por unidade ({periodLabel})</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {usage.bySite.map((b) => <li key={b.site} className="flex justify-between gap-2"><span className="truncate text-navy-700">{b.site}</span><span className="tabular text-navy-900">{kwhFmt(b.kwh)} · {b.sessions} rec.</span></li>)}
                    </ul>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
          {ops.alerts.length > 0 && (
            <Alert tone="warning" className="mt-4" title={`${ops.alerts.length} ${ops.alerts.length === 1 ? "ponto de atenção" : "pontos de atenção"} na operação`}>
              <ul className="list-disc pl-4">{ops.alerts.slice(0, 5).map((a, i) => <li key={i}>{a.text}</li>)}</ul>
            </Alert>
          )}
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-navy-400">Cadastro e projeções</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {sites && (
            <Stat label="Unidades em operação" value={num(sites.filter((s) => s.status === "OPERATING" && !s.isDemo).length)} definition="Unidades com status 'em operação', excluindo demonstrações." source="Cadastro de unidades" updatedAt={now} />
          )}
          {sims && <Stat label="Simulações salvas" value={num(sims.length)} definition="Simulações de viabilidade registradas pela organização (projeções)." source="Simulador" updatedAt={now} />}
        </div>
      </section>
    </>
  );
}
