import { requirePage } from "@/server/auth/current";
import { getCostPlan } from "@/server/modules/costs/service";
import { cancelCostActualAction, deactivateCostItemAction, recordCostActualAction, updateCostAssumptionsAction, upsertCostItemAction } from "@/app/actions/costs";
import { COST_CATEGORIES, COST_CATEGORY_LABEL } from "@/domain/costs/platform";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { Table } from "@/components/ui/table";
import { BarChart } from "@/components/ui/bar-chart";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, dateTime, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const p100 = (v: { toString(): string }) => String(+(Number(v.toString()) * 100).toFixed(4));

export default async function CustosPlataformaPage({ searchParams }: { searchParams: Promise<{ postos?: string }> }) {
  const ctx = await requirePage("finance:read");
  const sp = await searchParams;
  const asked = sp.postos !== undefined && /^\d{1,4}$/.test(sp.postos) ? Number(sp.postos) : undefined;
  const v = await getCostPlan(ctx, { stations: asked });
  const canWrite = ctx.permissions.has("finance:write");
  const canExport = ctx.permissions.has("finance:export");
  const thisMonth = v.history[0];
  const over = v.history.filter((h) => h.state === "OVER");
  return (
    <>
      <PageHeader
        title="Custos da plataforma"
        description="Quanto custa manter a WeMob no ar por mês: infraestrutura, serviços e operação, com câmbio de stress, reserva e custo por posto."
        actions={canExport && <a className="text-sm font-medium text-brand-700 hover:underline" href="/api/financeiro/exportar?tipo=custos&formato=xlsx">Exportar Excel</a>}
      />
      <Alert tone="info" className="mb-6" title="Despesa da WeMob — separada da receita">
        Este orçamento não entra no fechamento, nos repasses nem na participação de 30%: é o custo para manter a plataforma. Valores de planejamento, não cotações.
        Não inclui hardware, energia, aluguel de ponto nem tarifas por transação.
      </Alert>
      {over.length > 0 && (
        <Alert tone="warning" className="mb-6" title="Acima do orçamento">
          {over.map((h) => `${h.competence}: realizado ${brl(h.actual)} × orçado ${brl(h.budget)} (+${brl(h.variance)})`).join(" · ")}. Tolerância: {pct(v.assumptions.budgetTolerance.toString(), 0)}.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plataforma (base)" value={brl(v.plan.totals.base)} definition="Soma dos custos mensais dos itens, sem alta cambial nem reserva." source="Itens do orçamento abaixo." />
        <Stat label="Plataforma prudencial" value={brl(v.plan.totals.prudential)} tone="projection" definition={`Com alta do dólar de ${pct(v.assumptions.fxStressRate.toString(), 0)} sobre a parte exposta e reserva de ${pct(v.assumptions.reserveRate.toString(), 0)}.`} source="Premissas do orçamento." />
        <Stat label={`Total com ${v.plan.stations} posto(s)`} value={brl(v.plan.totalMonthly)} tone="projection" definition={`Plataforma prudencial + ${v.plan.stations} × ${brl(v.plan.perStationUnit)} por posto. Fixo ${brl(v.plan.fixedMonthly)} · variável ${brl(v.plan.variableMonthly)}.`} source={asked === undefined ? "Postos = estações de produção cadastradas." : "Número de postos informado na simulação."} />
        <Stat label="Exposição ao dólar" value={brl(v.plan.totals.dollarExposed)} definition="Parte da base mensal cotada em dólar (antes da alta de stress)." source="Exposição cambial de cada item." />
      </div>

      <Card className="mb-6">
        <CardHeader title="Simular número de postos" description={`Hoje: ${v.currentStations} estação(ões) de produção.`} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label="Postos" htmlFor="postos"><Input id="postos" name="postos" type="number" min={0} max={9999} defaultValue={asked ?? v.currentStations} className="w-32" /></Field>
            <button type="submit" className="h-10 rounded-lg bg-navy-900 px-4 text-sm font-medium text-white">Recalcular</button>
            {asked !== undefined && <a href="/app/financeiro/custos" className="h-10 px-2 text-sm leading-10 text-navy-600 underline">Voltar à rede atual</a>}
          </form>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Custos mensais por item" description="Base × (1 + exposição × alta cambial) = com câmbio; + reserva = prudencial." />
        <Table>
          <thead><tr><th>Item</th><th>Categoria</th><th className="text-right">Base</th><th className="text-right">Exposição</th><th className="text-right">Com câmbio</th><th className="text-right">Reserva</th><th className="text-right">Prudencial</th>{canWrite && <th />}</tr></thead>
          <tbody>
            {v.plan.lines.length === 0 && <tr><td colSpan={8} className="text-navy-500">Nenhum item no orçamento.</td></tr>}
            {v.plan.lines.map((l) => (
              <tr key={l.key}>
                <td className="font-medium text-navy-900">{l.name}</td>
                <td>{COST_CATEGORY_LABEL[l.category]}</td>
                <td className="tabular text-right">{brl(l.base)}</td>
                <td className="tabular text-right">{pct(l.fxExposure, 0)}</td>
                <td className="tabular text-right">{brl(l.withFx)}</td>
                <td className="tabular text-right">{brl(l.reserve)}</td>
                <td className="tabular text-right font-medium">{brl(l.prudential)}</td>
                {canWrite && (
                  <td>
                    <ActionForm action={deactivateCostItemAction} submitLabel="Retirar" size="sm" variant="secondary" confirm={`Retirar "${l.name}" do orçamento? O histórico de lançamentos é mantido.`}>
                      <input type="hidden" name="key" value={l.key} />
                    </ActionForm>
                  </td>
                )}
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={2}>Total da plataforma</td>
              <td className="tabular text-right">{brl(v.plan.totals.base)}</td><td />
              <td className="tabular text-right">{brl(v.plan.totals.withFx)}</td>
              <td className="tabular text-right">{brl(v.plan.totals.reserve)}</td>
              <td className="tabular text-right">{brl(v.plan.totals.prudential)}</td>{canWrite && <td />}
            </tr>
            <tr>
              <td colSpan={6}>Postos ({v.plan.stations} × {brl(v.assumptions.perStationCost.toString())} + reserva {brl(v.assumptions.perStationReserve.toString())})</td>
              <td className="tabular text-right">{brl(v.plan.variableMonthly)}</td>{canWrite && <td />}
            </tr>
            <tr className="font-semibold"><td colSpan={6}>Total mensal prudencial</td><td className="tabular text-right">{brl(v.plan.totalMonthly)}</td>{canWrite && <td />}</tr>
          </tbody>
        </Table>
        <p className="px-5 py-3 text-xs text-navy-500">Por categoria: {v.plan.byCategory.map((c) => `${COST_CATEGORY_LABEL[c.category]} ${brl(c.prudential)}`).join(" · ")}. Origem das premissas: {v.assumptions.sourceNote ?? "—"}</p>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Cenários por tamanho de rede" description="Mesmas premissas; só muda o número de postos." />
          <Table>
            <thead><tr><th>Cenário</th><th className="text-right">Postos</th><th className="text-right">Plataforma</th><th className="text-right">Postos</th><th className="text-right">Total/mês</th></tr></thead>
            <tbody>
              {v.scenarios.map((s) => (
                <tr key={s.name}><td>{s.name}</td><td className="tabular text-right">{num(s.stations)}</td><td className="tabular text-right">{brl(s.prudential)}</td><td className="tabular text-right">{brl(s.stationsCost)}</td><td className="tabular text-right font-medium">{brl(s.totalMonthly)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Risco cambial" description="Plataforma prudencial (sem postos) para cada alta do dólar." />
          <Table>
            <thead><tr><th>Alta do dólar</th><th className="text-right">Plataforma prudencial</th></tr></thead>
            <tbody>
              {v.fx.map((x) => (
                <tr key={x.fxStressRate}><td>{pct(x.fxStressRate, 0)}{x.fxStressRate === v.assumptions.fxStressRate.toString() && <Badge tone="navy" className="ml-2">premissa atual</Badge>}</td><td className="tabular text-right">{brl(x.prudential)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Realizado × orçado" description="Orçado com as premissas e postos atuais (o orçamento não é versionado por mês)." />
        <CardBody>
          <BarChart
            title="Custo realizado da plataforma"
            unit="R$"
            period={`${v.history.at(-1)?.competence} a ${v.history[0]?.competence}`}
            data={[...v.history].reverse().map((h) => ({ key: h.competence, label: h.competence, value: Number(h.actual ?? 0) }))}
            format={(n) => brl(n)}
            emptyText="Nenhum custo realizado lançado nos últimos 12 meses."
            tone="navy"
          />
        </CardBody>
        <Table>
          <thead><tr><th>Competência</th><th className="text-right">Orçado</th><th className="text-right">Realizado</th><th className="text-right">Diferença</th><th>Situação</th></tr></thead>
          <tbody>
            {v.history.slice(0, 6).map((h) => (
              <tr key={h.competence}>
                <td>{h.competence}</td><td className="tabular text-right">{brl(h.budget)}</td><td className="tabular text-right">{h.actual ? brl(h.actual) : "—"}</td>
                <td className="tabular text-right">{h.variance ? brl(h.variance) : "—"}</td>
                <td>{h.state === "OVER" ? <Badge tone="red">acima do orçado</Badge> : h.state === "WITHIN" ? <Badge tone="green">dentro</Badge> : <Badge>sem lançamento</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {thisMonth && <p className="px-5 py-3 text-xs text-navy-500">Mês atual ({thisMonth.competence}): {thisMonth.byCategory.length ? thisMonth.byCategory.map((c) => `${COST_CATEGORY_LABEL[c.category]} ${brl(c.amount)}`).join(" · ") : "nenhum lançamento"}.</p>}
      </Card>

      {v.entries.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Lançamentos realizados" />
          <Table>
            <thead><tr><th>Competência</th><th>Descrição</th><th>Categoria</th><th className="text-right">Valor (R$)</th><th>Moeda</th><th>Registrado</th>{canWrite && <th />}</tr></thead>
            <tbody>
              {v.entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.competence}</td><td>{e.description}</td><td>{COST_CATEGORY_LABEL[e.category]}</td><td className="tabular text-right">{brl(e.amount.toString())}</td>
                  <td className="text-xs">{e.currency === "USD" ? `US$ ${num(e.originalAmount?.toString(), 2)} × ${num(e.fxRate?.toString(), 4)}` : "R$"}</td>
                  <td className="text-xs">{dateTime(e.createdAt)}</td>
                  {canWrite && (
                    <td>
                      <ActionForm action={cancelCostActualAction} submitLabel="Cancelar" size="sm" variant="secondary" confirm="Cancelar este lançamento? Ele deixa de contar no realizado (fica no histórico).">
                        <input type="hidden" name="id" value={e.id} />
                        <Input name="reason" required minLength={5} placeholder="Motivo" aria-label="Motivo do cancelamento" className="w-40" />
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Lançar custo realizado" description="Fatura do mês. Em dólar, informe o valor em US$ e o câmbio: o valor em R$ é calculado." />
            <CardBody>
              <ActionForm action={recordCostActualAction} submitLabel="Registrar">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Competência" htmlFor="competence" required><Input id="competence" name="competence" type="month" required defaultValue={thisMonth?.competence} /></Field>
                  <Field label="Item (opcional)" htmlFor="itemKey"><Select id="itemKey" name="itemKey"><option value="">—</option>{v.items.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}</Select></Field>
                  <Field label="Categoria" htmlFor="category" required><Select id="category" name="category">{COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>)}</Select></Field>
                  <Field label="Moeda" htmlFor="currency"><Select id="currency" name="currency"><option value="BRL">Real (R$)</option><option value="USD">Dólar (US$)</option></Select></Field>
                  <Field label="Descrição" htmlFor="description" required className="sm:col-span-2"><Input id="description" name="description" required minLength={3} maxLength={200} placeholder="Ex.: fatura do servidor — outubro" /></Field>
                  <Field label="Valor em R$" htmlFor="amount" hint="Para fatura em real."><Input id="amount" name="amount" type="number" step="0.01" min="0.01" /></Field>
                  <Field label="Valor em US$" htmlFor="originalAmount" hint="Para fatura em dólar."><Input id="originalAmount" name="originalAmount" type="number" step="0.01" min="0.01" /></Field>
                  <Field label="Câmbio (R$ por US$)" htmlFor="fxRate"><Input id="fxRate" name="fxRate" type="number" step="0.0001" min="0.0001" /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Premissas" description="Mudanças ficam na auditoria com a justificativa." />
            <CardBody>
              <ActionForm action={updateCostAssumptionsAction} submitLabel="Salvar premissas" variant="secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Alta cambial de stress (%)" htmlFor="fxStressRate"><Input id="fxStressRate" name="fxStressRate" type="number" step="0.01" min="0" max="300" defaultValue={p100(v.assumptions.fxStressRate)} required /></Field>
                  <Field label="Reserva operacional (%)" htmlFor="reserveRate"><Input id="reserveRate" name="reserveRate" type="number" step="0.01" min="0" max="300" defaultValue={p100(v.assumptions.reserveRate)} required /></Field>
                  <Field label="Custo incremental por posto (R$)" htmlFor="perStationCost"><Input id="perStationCost" name="perStationCost" type="number" step="0.01" min="0" defaultValue={v.assumptions.perStationCost.toString()} required /></Field>
                  <Field label="Reserva por posto (R$)" htmlFor="perStationReserve"><Input id="perStationReserve" name="perStationReserve" type="number" step="0.01" min="0" defaultValue={v.assumptions.perStationReserve.toString()} required /></Field>
                  <Field label="Tolerância do alerta de orçamento (%)" htmlFor="budgetTolerance"><Input id="budgetTolerance" name="budgetTolerance" type="number" step="0.1" min="0" max="100" defaultValue={p100(v.assumptions.budgetTolerance)} required /></Field>
                  <Field label="Origem / justificativa" htmlFor="sourceNote" className="sm:col-span-2"><Input id="sourceNote" name="sourceNote" required minLength={5} maxLength={500} placeholder="Ex.: cotação do provedor X em 11/2026" /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Adicionar ou alterar item" description="Mesma chave = atualiza o item existente." />
            <CardBody>
              <ActionForm action={upsertCostItemAction} submitLabel="Salvar item" variant="secondary">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Chave" htmlFor="key" hint="Ex.: app-api"><Input id="key" name="key" required pattern="[a-z0-9-]{2,40}" /></Field>
                  <Field label="Nome" htmlFor="name"><Input id="name" name="name" required minLength={2} /></Field>
                  <Field label="Categoria" htmlFor="item-category"><Select id="item-category" name="category">{COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>)}</Select></Field>
                  <Field label="Base (R$/mês)" htmlFor="baseMonthly"><Input id="baseMonthly" name="baseMonthly" type="number" step="0.01" min="0" required /></Field>
                  <Field label="Exposição ao dólar (%)" htmlFor="fxExposure"><Input id="fxExposure" name="fxExposure" type="number" step="1" min="0" max="100" required defaultValue={0} /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
