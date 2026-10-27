import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getSimulation } from "@/server/modules/commercial/service";
import { normalizeStoredInput, type ViabilityResult } from "@/domain/viability/engine";
import { INPUT_LABELS, type Change } from "@/domain/viability/diff";
import { FEE_BASE_LABEL, LOSS_TREATMENT_LABEL } from "@/domain/commercial/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { SimulatorResults } from "@/components/simulator/simulator-results";
import { PrintButton } from "@/app/app/crm/propostas/[id]/imprimir/print-button";
import { brl, dateTime, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? num(v, 4).replace(/,?0+$/, "") : String(v));

export default async function SimulacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("simulation:read");
  const s = await getSimulation(ctx, (await params).id).catch(() => notFound());
  const normalized = normalizeStoredInput(s.inputs);
  if (!normalized) throw new Error(`Premissas da simulação ${s.id} não são legíveis pelo motor atual.`);
  const input = { ...normalized, versionStatusAtRun: (s.inputs as { versionStatusAtRun?: string }).versionStatusAtRun };
  const result = s.results as unknown as ViabilityResult;
  const t = input.terms;
  const changes = (s.changes ?? []) as Change[];
  const util = input.occupancyRate !== undefined
    ? `${pct(input.occupancyRate)} de ocupação × ${pct(input.averagePowerFactor, 0)} da potência`
    : `${num(input.equivalentHoursPerDay ?? 0, 2)} h equivalentes/dia`;
  const assumptions: [string, string][] = [
    ["Carregadores", input.chargers.map((c) => `${c.count} × ${num(c.powerKw)} kW`).join(" + ") + (input.gridLimitKw ? ` (limite de conexão ${num(input.gridLimitKw)} kW)` : "")],
    ["Disponibilidade · eficiência", `${pct(input.availability)} · ${pct(input.chargingEfficiency)}`],
    ["Utilização", util],
    ["Dias/mês · prazo", `${num(input.daysPerMonth, 2)} · ${input.horizonMonths} meses`],
    ["Crescimento mensal", pct(input.monthlyGrowthRate)],
    ["Preço de venda · custo da energia", `${brl(input.pricePerKwh)}/kWh · ${brl(input.energyCostPerKwh)}/kWh`],
    ["kWh por sessão", input.kwhPerSession ? num(input.kwhPerSession, 1) : "não informado"],
    ["Comissões · gateway à parte", `${pct(input.commissionRate)} · ${pct(input.gatewayRate)} + ${brl(input.gatewayFixedPerSession)}/sessão`],
    ["Custos fixos mensais", brl(Object.values(input.fixedMonthly).reduce((a, v) => a + v, 0))],
    ["Investimento total · capital de giro", `${brl(result.investment.total)} · ${brl(input.workingCapital)}${input.workingCapital > 0 ? (input.recoverWorkingCapital ? " (devolvido no fim)" : " (não devolvido)") : ""}`],
    ["Taxa de desconto", input.discountRateAnnual === undefined ? "não informada" : `${pct(input.discountRateAnnual)} a.a.`],
  ];
  const termsRows: [string, string][] = [
    ["Modelo", `${t.modelName} v${t.version ?? "?"} (${input.versionStatusAtRun === "DRAFT" ? "rascunho no momento do cálculo" : "aprovada"})`],
    ["Aporte / resultado do investidor", `${pct(t.partnerCapitalShare, 0)} / ${pct(t.partnerResultShare, 0)}`],
    ["Royalty", `${pct(t.royaltyRate)} sobre ${FEE_BASE_LABEL[t.royaltyBase].toLowerCase()}`],
    ["Taxa de sistema", `${pct(t.platformFeeRate)} sobre ${FEE_BASE_LABEL[t.platformFeeBase].toLowerCase()} — ${t.platformFeeIncludesGateway ? "inclui gateway" : "gateway à parte"}`],
    ["Tributos", `${pct(t.taxRate)} sobre ${FEE_BASE_LABEL[t.taxBase].toLowerCase()}`],
    ["Partilha", `Resultado operacional mensal; ${LOSS_TREATMENT_LABEL[t.lossTreatment].toLowerCase()}`],
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Simulador", href: "/app/simulador" }, { label: s.name }]}
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">Projeção</Badge> revisão {s.revision} · {s.authorName ?? "autor desconhecido"} · {dateTime(s.createdAt)} · motor {s.engineVersion}
          </span>
        }
        actions={
          <span className="flex gap-2 print:hidden">
            {ctx.permissions.has("simulation:run") && <ButtonLink href={`/app/simulador?revisar=${s.id}`} variant="secondary">Nova revisão</ButtonLink>}
            <PrintButton />
          </span>
        }
      />
      <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Premissas operacionais" />
          <Table><tbody>{assumptions.map(([k, v]) => <tr key={k}><td className="text-navy-500">{k}</td><td>{v}</td></tr>)}</tbody></Table>
        </Card>
        <Card>
          <CardHeader title="Condições comerciais aplicadas" description="Carregadas da versão do modelo no banco, no momento do cálculo." />
          <Table><tbody>{termsRows.map(([k, v]) => <tr key={k}><td className="text-navy-500">{k}</td><td>{v}</td></tr>)}</tbody></Table>
        </Card>
      </div>
      {(s.parent || s.revisions.length > 0) && (
        <Card className="mb-6">
          <CardHeader title="Histórico de revisões" />
          <CardBody className="flex flex-col gap-3 text-sm">
            {s.parent && (
              <p>Revisão de <Link className="text-brand-700 underline" href={`/app/simulador/${s.parent.id}`}>{s.parent.name} (rev. {s.parent.revision})</Link>.</p>
            )}
            {changes.length > 0 && (
              <Table>
                <thead><tr><th>Premissa alterada</th><th>Antes</th><th>Depois</th></tr></thead>
                <tbody>{changes.map((c) => <tr key={c.path}><td>{INPUT_LABELS[c.path] ?? c.path}</td><td className="tabular">{show(c.before)}</td><td className="tabular">{show(c.after)}</td></tr>)}</tbody>
              </Table>
            )}
            {s.parent && changes.length === 0 && <p className="text-navy-500">Nenhuma premissa alterada em relação à revisão anterior.</p>}
            {s.revisions.length > 0 && (
              <p>Revisões posteriores: {s.revisions.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link className="text-brand-700 underline" href={`/app/simulador/${r.id}`}>rev. {r.revision} — {r.name}</Link></span>)}</p>
            )}
          </CardBody>
        </Card>
      )}
      {result.years && result.viabilityThresholds ? (
        <SimulatorResults result={result} terms={t} />
      ) : (
        <Alert tone="warning" title={`Calculada com o motor ${s.engineVersion}`}>
          Este registro é anterior ao motor atual e não contém todos os indicadores do relatório. Os valores salvos são preservados como estão; use “Nova revisão” para recalcular com o motor atual.
          <p className="mt-2">Resultado do investidor no mês 1: <b>{brl(result.months[0]?.partnerResult)}</b> · payback: <b>{result.kpis.partnerPaybackMonths ?? "não atingido"}</b></p>
        </Alert>
      )}
    </>
  );
}
