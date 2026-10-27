"use client";

import type { ViabilityResult } from "@/domain/viability/engine";
import { FEE_BASE_LABEL, type CommercialTerms } from "@/domain/commercial/types";
import { Alert } from "@/components/ui/alert";
import { Table } from "@/components/ui/table";
import { brl, dateTime, kwh, num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

const DRIVER_LABEL = { utilization: "Utilização", price: "Preço de venda", energyCost: "Custo da energia", fixedCosts: "Custos fixos" } as const;

export function SimulatorResults({
  result,
  terms,
  scenarios,
  modelsCmp,
}: {
  result: ViabilityResult;
  terms: CommercialTerms;
  scenarios: { key: string; label: string; hours: number; result: ViabilityResult }[];
  modelsCmp: { terms: CommercialTerms; result: ViabilityResult }[];
}) {
  const m1 = result.months[0];
  const k = result.kpis;
  const isPartial = terms.partnerResultShare < 1;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <Alert tone="warning" title="Projeção — não é resultado real nem garantia de rentabilidade">
        Calculada em {dateTime(result.computedAt)} (motor {result.engineVersion}) a partir das premissas ao lado e das condições de{" "}
        <b>{terms.modelName}{terms.version ? ` v${terms.version}` : ""}</b>. Valores contratuais, tributários e de energia devem ser validados.
      </Alert>

      {result.warnings.length > 0 && (
        <Alert tone="info" title="Observações sobre as premissas">
          <ul className="list-disc space-y-0.5 pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Energia vendida (mês 1)" value={kwh(m1.energySoldKwh)} sub={`Capacidade: ${kwh(result.physical.monthlyCapacityKwh)}/mês`} />
        <Kpi label="Faturamento bruto (mês 1)" value={brl(m1.grossRevenue)} sub={`${num(m1.energySoldKwh)} kWh × preço`} />
        <Kpi label="Resultado operacional (mês 1)" value={brl(m1.operatingResult)} sub={`Margem: ${pct(k.operatingMarginOnGross)}`} tone={Number(m1.operatingResult) < 0 ? "neg" : "pos"} />
        <Kpi label={isPartial ? "Parte do investidor (mês 1)" : "Resultado do investidor (mês 1)"} value={brl(m1.partnerResult)} sub={`${pct(terms.partnerResultShare, 0)} do resultado`} tone={Number(m1.partnerResult) < 0 ? "neg" : "pos"} highlight />
        <Kpi label="Investimento do investidor" value={brl(result.investment.partner)} sub={`Total da unidade: ${brl(result.investment.total)}`} />
        <Kpi label="Payback simples" value={k.partnerPaybackMonths === null ? "Não atinge" : `${num(k.partnerPaybackMonths, 1)} meses`} sub={k.partnerPaybackMonths === null ? "no prazo analisado" : "sem desconto"} />
        <Kpi label="Retorno no 1º ano" value={pct(k.partnerFirstYearReturnRate)} sub={brl(k.partnerFirstYearReturn)} />
        <Kpi label={`ROI em ${result.months.length} meses`} value={pct(k.partnerRoiHorizon)} sub="(resultado − investimento) ÷ investimento" />
        <Kpi label="VPL" value={k.npv === null ? "—" : brl(k.npv)} sub={k.npv === null ? "Informe a taxa de desconto" : "fluxo do investidor"} />
        <Kpi label="TIR" value={k.irrAnnual === null ? "—" : pct(k.irrAnnual)} sub={k.irrMonthly === null ? "Indefinida para estes fluxos" : `${pct(k.irrMonthly, 2)} ao mês`} />
        <Kpi label="Ponto de equilíbrio" value={k.breakEvenKwhPerMonth === null ? "—" : kwh(k.breakEvenKwhPerMonth)} sub={k.breakEvenHoursPerDay === null ? "margem negativa" : `≈ ${num(k.breakEvenHoursPerDay, 2)} h/dia equivalentes`} />
        <Kpi label="Margem de contribuição" value={`${brl(k.contributionMarginPerKwh)}/kWh`} sub="após taxas, tributos, royalty e energia" />
      </div>

      <section className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
        <h3 className="border-b border-navy-100 px-5 py-3 font-display font-semibold text-navy-900">Demonstrativo do mês 1 e memória de cálculo</h3>
        <Table>
          <thead>
            <tr><th>Linha</th><th className="text-right">Valor</th><th>Fórmula</th></tr>
          </thead>
          <tbody>
            <Line label="Faturamento bruto" v={m1.grossRevenue} f={`${num(m1.energySoldKwh, 1)} kWh × preço de venda`} strong />
            <Line label="(−) Taxa de sistema + gateway" v={m1.paymentFees} neg f={`${pct(terms.platformFeeRate)} × ${FEE_BASE_LABEL[terms.platformFeeBase].toLowerCase()}`} />
            <Line label="= Receita após taxa de pagamento" v={m1.revenueAfterPaymentFees} f="bruto − taxa de sistema" />
            <Line label="(−) Tributos estimados" v={m1.taxes} neg f={`${pct(terms.taxRate)} × ${FEE_BASE_LABEL[terms.taxBase].toLowerCase()}`} />
            <Line label="(−) Royalty" v={m1.royalty} neg f={`${pct(terms.royaltyRate)} × ${FEE_BASE_LABEL[terms.royaltyBase].toLowerCase()}`} />
            {Number(m1.commission) > 0 && <Line label="(−) Comissões" v={m1.commission} neg f="% × bruto" />}
            <Line label="(−) Custo da energia" v={m1.energyCost} neg f={`${num(m1.energyPurchasedKwh, 1)} kWh comprados × custo/kWh`} />
            <Line label="(−) Custos fixos" v={m1.fixedCosts} neg f="soma dos custos fixos mensais" />
            <Line label="= Resultado operacional" v={m1.operatingResult} f="bruto − custos variáveis − fixos" strong />
            <Line label={`Resultado distribuível ao investidor (${pct(terms.partnerResultShare, 0)})`} v={m1.partnerResult} f="resultado operacional × participação" strong />
            {isPartial && <Line label={`Parte Sansol Mob (${pct(1 - terms.partnerResultShare, 0)})`} v={m1.operatorResult} f="resultado operacional − parte do investidor" />}
          </tbody>
        </Table>
        <p className="px-5 py-3 text-xs text-navy-400">
          Faturamento ≠ resultado operacional ≠ fluxo de caixa ≠ lucro distribuível. O resultado acima é gerencial e não substitui apuração contábil.
          O royalty é devido à franqueadora e já está deduzido do resultado.
        </p>
      </section>

      <CashChart result={result} />

      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
          <h3 className="border-b border-navy-100 px-5 py-3 font-display font-semibold text-navy-900">Cenários de utilização</h3>
          <Table>
            <thead><tr><th>Cenário</th><th className="text-right">Investidor/mês</th><th className="text-right">Payback</th></tr></thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.key}>
                  <td>{s.label} <span className="text-navy-400">({s.hours} h/dia)</span></td>
                  <td className="tabular text-right">{brl(s.result.months[0].partnerResult)}</td>
                  <td className="tabular text-right">{s.result.kpis.partnerPaybackMonths === null ? "—" : `${num(s.result.kpis.partnerPaybackMonths, 1)} m`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
          <h3 className="border-b border-navy-100 px-5 py-3 font-display font-semibold text-navy-900">Comparação entre modelos</h3>
          <Table>
            <thead><tr><th>Modelo</th><th className="text-right">Aporte</th><th className="text-right">Investidor/mês</th><th className="text-right">Payback</th></tr></thead>
            <tbody>
              {modelsCmp.map((m) => (
                <tr key={m.terms.modelKey + (m.terms.versionId ?? "")}>
                  <td>{m.terms.modelName}</td>
                  <td className="tabular text-right">{brl(m.result.investment.partner)}</td>
                  <td className="tabular text-right">{brl(m.result.months[0].partnerResult)}</td>
                  <td className="tabular text-right">{m.result.kpis.partnerPaybackMonths === null ? "—" : `${num(m.result.kpis.partnerPaybackMonths, 1)} m`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 py-3 text-xs text-navy-400">Mesmas premissas operacionais; muda apenas a versão vigente de cada modelo e o investimento de referência.</p>
        </section>
      </div>

      {result.sensitivity.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
          <h3 className="border-b border-navy-100 px-5 py-3 font-display font-semibold text-navy-900">Sensibilidade — resultado médio mensal do investidor (12 meses)</h3>
          <Table>
            <thead><tr><th>Variável</th><th className="text-right">−20%</th><th className="text-right">−10%</th><th className="text-right">Atual</th><th className="text-right">+10%</th><th className="text-right">+20%</th></tr></thead>
            <tbody>
              {(Object.keys(DRIVER_LABEL) as (keyof typeof DRIVER_LABEL)[]).map((d) => {
                const rows = result.sensitivity.filter((s) => s.driver === d);
                const avg = result.months.slice(0, 12).reduce((a, r) => a + Number(r.partnerResult), 0) / Math.min(12, result.months.length);
                return (
                  <tr key={d}>
                    <td>{DRIVER_LABEL[d]}</td>
                    {rows.slice(0, 2).map((r) => <td key={r.delta} className="tabular text-right">{brl(r.partnerAvgMonthlyResult)}</td>)}
                    <td className="tabular text-right font-semibold">{brl(avg.toFixed(2))}</td>
                    {rows.slice(2).map((r) => <td key={r.delta} className="tabular text-right">{brl(r.partnerAvgMonthlyResult)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}

      <details className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
        <summary className="cursor-pointer px-5 py-3 font-display font-semibold text-navy-900">Fluxo mensal completo ({result.months.length} meses)</summary>
        <Table className="text-xs">
          <thead>
            <tr><th>Mês</th><th className="text-right">kWh</th><th className="text-right">Bruto</th><th className="text-right">Variáveis</th><th className="text-right">Fixos</th><th className="text-right">Operacional</th><th className="text-right">Investidor</th><th className="text-right">Acumulado</th></tr>
          </thead>
          <tbody>
            {result.months.map((r) => (
              <tr key={r.month}>
                <td>{r.month}{r.capacityCapped && <span title="Limitado pela capacidade" className="ml-1 text-amber-600">●</span>}</td>
                <td className="tabular text-right">{num(r.energySoldKwh)}</td>
                <td className="tabular text-right">{brl(r.grossRevenue)}</td>
                <td className="tabular text-right">{brl(r.variableCosts)}</td>
                <td className="tabular text-right">{brl(r.fixedCosts)}</td>
                <td className="tabular text-right">{brl(r.operatingResult)}</td>
                <td className="tabular text-right">{brl(r.partnerResult)}</td>
                <td className={cn("tabular text-right", Number(r.partnerCumulativeCash) < 0 ? "text-red-600" : "text-brand-700")}>{brl(r.partnerCumulativeCash)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Total</td>
              <td className="tabular text-right">{num(result.totals.energySoldKwh)}</td>
              <td className="tabular text-right">{brl(result.totals.grossRevenue)}</td>
              <td className="tabular text-right">{brl(result.totals.variableCosts)}</td>
              <td className="tabular text-right">{brl(result.totals.fixedCosts)}</td>
              <td className="tabular text-right">{brl(result.totals.operatingResult)}</td>
              <td className="tabular text-right">{brl(result.totals.partnerResult)}</td>
              <td />
            </tr>
          </tbody>
        </Table>
      </details>
    </div>
  );
}

function Kpi({ label, value, sub, tone, highlight }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3.5", highlight ? "border-brand-200 bg-brand-50" : "border-navy-100 bg-white")}>
      <p className="text-xs text-navy-500">{label}</p>
      <p className={cn("tabular mt-1 font-display text-lg font-semibold", tone === "neg" ? "text-red-600" : "text-navy-900")}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-navy-400">{sub}</p>}
    </div>
  );
}

function Line({ label, v, f, neg, strong }: { label: string; v: string; f: string; neg?: boolean; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : undefined}>
      <td>{label}</td>
      <td className={cn("tabular whitespace-nowrap text-right", neg && "text-navy-500")}>{neg ? `− ${brl(v)}` : brl(v)}</td>
      <td className="text-xs text-navy-400">{f}</td>
    </tr>
  );
}

/** Caixa acumulado do investidor (inclui o aporte no mês 0). Gráfico funcional, não decorativo. */
function CashChart({ result }: { result: ViabilityResult }) {
  const pts = [-Number(result.investment.partner), ...result.months.map((m) => Number(m.partnerCumulativeCash))];
  const min = Math.min(0, ...pts);
  const max = Math.max(0, ...pts);
  const W = 640;
  const H = 200;
  const pad = 8;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + ((max - v) / (max - min || 1)) * (H - 2 * pad);
  const path = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const pb = result.kpis.partnerPaybackMonths;
  return (
    <section className="rounded-[var(--radius-card)] border border-navy-100 bg-white p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-semibold text-navy-900">Caixa acumulado do investidor</h3>
        <p className="text-xs text-navy-500">Mês 0 = aporte · eixo horizontal: meses · {pb === null ? "payback não atingido" : `payback ≈ mês ${num(pb, 1)}`}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={`Caixa acumulado: de ${brl(pts[0])} a ${brl(pts[pts.length - 1])}`}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#c7d2e1" strokeDasharray="4 4" />
        {pb !== null && <line x1={x(pb)} x2={x(pb)} y1={pad} y2={H - pad} stroke="#3fcbc6" strokeWidth="1.5" />}
        <path d={path} fill="none" stroke="#16a36b" strokeWidth="2.5" strokeLinejoin="round" />
        <text x={pad + 2} y={y(0) - 4} fontSize="11" fill="#6a7f9e">R$ 0</text>
      </svg>
      <div className="mt-1 flex justify-between text-xs text-navy-500 tabular">
        <span>{brl(pts[0])}</span>
        <span>{brl(pts[pts.length - 1])}</span>
      </div>
    </section>
  );
}
