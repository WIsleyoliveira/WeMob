import { requirePage } from "@/server/auth/current";
import { partnerContracts, partnerIndicators, partnerSplits, partnerStatements } from "@/server/modules/partner/portal";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { SettlementTable } from "@/components/app/settlement-table";
import { describeTerms } from "@/domain/finance/contracts";
import { brl, date, dateTime, num, pct } from "@/lib/format";
import { networkUsage } from "@/server/modules/usage/service";
import { BarChart } from "@/components/ui/bar-chart";
import { MeterList } from "@/components/ui/meter-list";
import { cn } from "@/lib/cn";
import Decimal from "decimal.js";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PERIODS = { "7": "7 dias", "30": "30 dias", "90": "90 dias" } as const;
type PeriodKey = keyof typeof PERIODS;
const SECTIONS = [["indicadores", "Indicadores"], ["contratos", "Contratos"], ["extratos", "Extratos"], ["repasses", "Repasses automáticos"]] as const;

/** Portal do operador do posto: só as próprias unidades, contratos e extratos aprovados (isolamento no serviço). */
export default async function PortalPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await requirePage("partner_portal:read");
  if (ctx.orgKind === "OPERATOR") return <Alert tone="info">O portal é exclusivo de parceiros e investidores. A operadora acompanha estes dados em Financeiro e Contratos.</Alert>;
  const sp = await searchParams;
  const period: PeriodKey = sp.periodo && sp.periodo in PERIODS ? (sp.periodo as PeriodKey) : "30";
  const days = Number(period);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const [contracts, statements, ind, splits, usage] = await Promise.all([partnerContracts(ctx), partnerStatements(ctx), partnerIndicators(ctx, days), partnerSplits(ctx), networkUsage(ctx, { from, to })]);
  const conns = ind.perConnector;
  const availability = conns.length ? conns.reduce((a, c) => a + c.availability, 0) / conns.length : null;
  const utilization = conns.length ? conns.reduce((a, c) => a + c.utilization, 0) / conns.length : null;
  // Sua parte por competência (fechamentos aprovados, mais antigos à esquerda) e o que ainda falta receber.
  const shares = [...statements].reverse().slice(-12).map((s) => ({ key: s.period, label: s.period.slice(2).replace("-", "/"), value: Number(s.totals.partnerShare) }));
  const toReceive = statements.reduce((a, s) => a.plus(s.provisioned).minus(s.paid), new Decimal(0));
  const last = statements[0];
  const bucket = usage.granularity === "day" ? "por dia" : usage.granularity === "week" ? "por semana" : "por mês";
  return (
    <>
      <PageHeader title={`Meu posto — ${ctx.organizationName}`} description="Somente as suas unidades e contratos. Valores financeiros vêm dos fechamentos aprovados pela operadora (WeMob 30% / posto 70% nos contratos de participação)." />
      <nav aria-label="Seções do portal" className="mb-6 flex flex-wrap gap-2 text-sm">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-full border border-navy-200 bg-white px-3 py-1.5 font-medium text-navy-700 hover:border-navy-300 hover:text-navy-900">{label}</a>)}
      </nav>

      <section id="indicadores" aria-labelledby="indicadores-titulo" className="mb-10 scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="indicadores-titulo" className="font-display text-lg font-semibold text-navy-900">Operação das suas estações</h2>
          <div className="flex rounded-lg border border-navy-200 bg-white p-0.5 text-sm" role="group" aria-label="Período">
            {(Object.keys(PERIODS) as PeriodKey[]).map((k) => <Link key={k} href={`/app/portal?periodo=${k}`} aria-current={k === period ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", k === period ? "bg-navy-900 font-medium text-white" : "text-navy-600 hover:text-navy-900")}>{PERIODS[k]}</Link>)}
          </div>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={`Energia entregue (${PERIODS[period]})`} value={`${num(ind.sessions.energyKwhCompleted, 1)} kWh`} definition="Σ (medidor final − inicial) das sessões de produção concluídas." source="Servidor OCPP" updatedAt={ind.computedAt} />
          <Stat label={`Recargas concluídas (${PERIODS[period]})`} value={num(ind.sessions.completed)} definition="Sessões de produção concluídas no período (recusadas na autorização não contam)." source="Servidor OCPP" updatedAt={ind.computedAt} />
          <Stat label="Disponibilidade média" value={availability === null ? "—" : pct(availability)} definition="Média por conector do tempo fora de Indisponível/Em falha/Sem comunicação ÷ período." source="Status OCPP" updatedAt={ind.computedAt} />
          <Stat label="A receber" value={brl(toReceive.toFixed(2))} definition="Repasses provisionados nos fechamentos aprovados − valores já pagos." source="Fechamentos e lançamentos" updatedAt={ind.computedAt} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <BarChart title="Energia entregue" unit={`kWh ${bucket}`} period={`últimos ${PERIODS[period]} · somente produção`} data={usage.series.map((p) => ({ key: p.key, label: p.label, value: p.kwh }))} format={(v) => `${num(v, v < 10 ? 2 : 1)} kWh`} emptyText="Nenhuma recarga concluída no período nas suas estações." />
          <BarChart title="Sua parte por competência" unit="R$ por mês (fechamentos aprovados)" period={statements.length ? `${statements.at(-1)!.period} a ${statements[0].period}` : "sem fechamentos"} tone="navy" data={shares} format={(v) => brl(v)} emptyText="Nenhum fechamento aprovado ainda. Quando a operadora aprovar o mês, sua parte aparece aqui." />
          <Card>
            <CardHeader title="Utilização por conector" description={`Tempo ocupado (carregando/preparando/finalizando) ÷ período · média ${utilization === null ? "—" : pct(utilization)}`} />
            <CardBody><MeterList tone="tiffany" items={conns.map((c) => ({ key: `${c.stationId}-${c.connectorId}`, label: `${c.identity} · conector ${c.connectorId}`, sub: c.site, value: c.utilization }))} emptyText="Nenhuma estação de produção nas suas unidades." /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Disponibilidade por conector" description="Abaixo de 95% aparece em destaque. Sem comunicação conta como indisponível." />
            <CardBody><MeterList thresholds={{ warnBelow: 0.95 }} items={conns.map((c) => ({ key: `${c.stationId}-${c.connectorId}`, label: `${c.identity} · conector ${c.connectorId}`, sub: c.site, value: c.availability }))} emptyText="Nenhuma estação de produção nas suas unidades." /></CardBody>
          </Card>
        </div>
        {last && <p className="mt-3 text-xs text-navy-500">Último fechamento: {last.period} — sua parte {brl(last.totals.partnerShare)}{Number(last.totals.wemobShare ?? 0) > 0 ? ` · participação da rede ${brl(last.totals.wemobShare)}` : ""}.</p>}
      </section>

      <Alert tone="info" className="mb-6">Valores gerenciais. Para fins fiscais/contábeis, consulte seu contador. Dúvidas sobre o extrato: fale com a operadora da rede.</Alert>
      <h2 id="contratos" className="mb-3 scroll-mt-24 font-display text-lg font-semibold text-navy-900">Contratos e documentos</h2>
      {contracts.length === 0 ? <EmptyState title="Nenhum contrato ativo" /> : (
        <div className="mb-8 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {contracts.map((c) => (
            <Card key={c.id}>
              <CardHeader title={`${c.number} · ${c.title}`} description={c.sites.map((s) => s.site.name).join(", ")} />
              <CardBody className="space-y-3 text-sm">
                {c.current ? <p>Condição vigente (v{c.current.version} desde {date(c.current.effectiveFrom)}): {describeTerms(c.current)}.</p> : <p className="text-amber-700">Sem versão aprovada vigente.</p>}
                <ul className="space-y-1">{c.documents.length === 0 ? <li className="text-navy-500">Nenhum documento disponibilizado.</li> : c.documents.map((d) => <li key={d.id}><a className="text-brand-700 hover:underline" href={`/api/anexos/${d.id}`}>{d.filename}</a> <span className="text-xs text-navy-400">({(d.size / 1024).toFixed(0)} KB)</span></li>)}</ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <h2 id="extratos" className="mb-3 scroll-mt-24 font-display text-lg font-semibold text-navy-900">Extratos</h2>
      {statements.length === 0 ? <EmptyState title="Nenhum fechamento aprovado ainda" /> : statements.map((s) => (
        <Card key={s.closingId} className="mb-6">
          <CardHeader
            title={`Competência ${s.period}`}
            description={`Aprovado em ${s.approvedAt ? dateTime(s.approvedAt) : "—"} · seu repasse ${brl(s.totals.partnerShare)} · provisionado ${brl(s.provisioned)} · pago ${brl(s.paid)}`}
            actions={<span className="flex gap-3"><a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/portal/extrato?periodo=${s.period}&formato=xlsx`}>Baixar Excel</a><a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/portal/extrato?periodo=${s.period}`}>CSV</a></span>}
          />
          <SettlementTable lines={s.lines} />
          {(s.repasses.length > 0 || s.adjustments.length > 0) && (
            <Table>
              <thead><tr><th>Lançamento</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {[...s.repasses, ...s.adjustments].map((e) => (
                  <tr key={e.id}><td>{e.description}{e.adjustsPeriod && <Badge tone="amber" className="ml-2">ajuste</Badge>}</td><td>{e.dueDate ? date(e.dueDate) : "—"}</td><td><Badge tone={e.status === "PAID" ? "green" : "amber"}>{e.status === "PAID" ? `Pago em ${e.paidAt ? date(e.paidAt) : "—"}` : "Provisionado"}</Badge></td><td className="tabular text-right">{e.kind === "RECEIVABLE" ? "−" : ""}{brl(e.amount.toString())}</td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ))}
      <Card id="repasses" className="mt-6 scroll-mt-24">
        <CardHeader title="Repasses automáticos (split Asaas)" description="Parcelas das cobranças das suas unidades destinadas à sua carteira. Percentuais incidem sobre o valor líquido (após tarifas do gateway). “Liquidado” somente após confirmação do Asaas." />
        {splits.rows.length === 0 ? <CardBody><p className="text-sm text-navy-500">Nenhuma cobrança com split para a sua organização. Repasses seguem pelos extratos mensais acima.</p></CardBody> : (
          <>
            <CardBody className="grid gap-3 sm:grid-cols-3 text-sm">
              <p>Liquidado (produção): <b className="tabular">{brl(splits.settledProduction)}</b></p>
              <p>Em processamento: <b>{splits.pending}</b></p>
              {Number(splits.settledSandbox) > 0 && <p className="text-amber-800">Sandbox (sem dinheiro real): {brl(splits.settledSandbox)}</p>}
            </CardBody>
            <Table className="text-xs">
              <thead><tr><th>Data</th><th>Unidade</th><th className="text-right">Cobrado</th><th className="text-right">Líquido</th><th className="text-right">Sua parcela</th><th>Status</th></tr></thead>
              <tbody>
                {splits.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.payment.createdAt)} {r.payment.environment === "SANDBOX" && <Badge tone="amber">sandbox</Badge>}</td>
                    <td>{r.payment.session?.station.site.name ?? "—"}</td>
                    <td className="tabular text-right">{brl(r.payment.amountCaptured.toString())}</td>
                    <td className="tabular text-right">{r.payment.netValue ? brl(r.payment.netValue.toString()) : "—"}</td>
                    <td className="tabular text-right">{r.totalValue ? brl(r.totalValue.toString()) : r.percentualValue ? `${r.percentualValue}% (a apurar)` : "—"}</td>
                    <td><Badge tone={r.status === "DONE" ? "green" : ["CANCELLED", "BLOCKED_BY_VALUE_DIVERGENCE", "REFUNDED"].includes(r.status) ? "red" : "neutral"}>{r.status === "DONE" ? "liquidado" : r.status === "BLOCKED_BY_VALUE_DIVERGENCE" ? "bloqueado (divergência)" : r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </>
  );
}
