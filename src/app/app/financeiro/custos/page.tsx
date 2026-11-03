import { requirePage } from "@/server/auth/current";
import { costChangeHistory, getCostImport, getCostPlan, listBudgetVersions } from "@/server/modules/costs/service";
import { applyCostImportAction, cancelCostActualAction, deactivateCostItemAction, discardCostImportAction, freezeBudgetAction, previewCostImportAction, recordCostActualAction, updateCostAssumptionsAction, upsertCostItemAction } from "@/app/actions/costs";
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

const ACTION_LABEL: Record<string, string> = {
  "platform_cost.assumptions_updated": "Premissas alteradas",
  "platform_cost.item_updated": "Item alterado",
  "platform_cost.item_created": "Item criado",
  "platform_cost.item_deactivated": "Item retirado",
  "platform_cost.actual_recorded": "Custo realizado lançado",
  "platform_cost.actual_cancelled": "Lançamento cancelado",
  "platform_cost.budget_frozen": "Orçamento do mês congelado",
  "platform_cost.import_previewed": "Planilha enviada (prévia)",
  "platform_cost.import_applied": "Planilha aplicada",
  "platform_cost.import_discarded": "Importação descartada",
  "platform_cost.exported": "Orçamento exportado",
};
const signed = (v: string | null) => (v === null ? "—" : `${Number(v) > 0 ? "+" : ""}${brl(v)}`);

export default async function CustosPlataformaPage({ searchParams }: { searchParams: Promise<{ postos?: string; importacao?: string }> }) {
  const ctx = await requirePage("finance:read");
  const sp = await searchParams;
  const asked = sp.postos !== undefined && /^\d{1,4}$/.test(sp.postos) ? Number(sp.postos) : undefined;
  const [v, versions, changes, imp] = await Promise.all([
    getCostPlan(ctx, { stations: asked }),
    listBudgetVersions(ctx),
    costChangeHistory(ctx),
    sp.importacao && /^[a-z0-9]{20,40}$/.test(sp.importacao) ? getCostImport(ctx, sp.importacao).catch(() => null) : null,
  ]);
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
        <CardHeader title="Realizado × orçado" description="Orçado do mês = versão congelada da competência; sem versão, as premissas atuais (marcado)." />
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
          <thead><tr><th>Competência</th><th>Orçamento</th><th className="text-right">Orçado</th><th className="text-right">Δ mês anterior</th><th className="text-right">Realizado</th><th className="text-right">Δ mês anterior</th><th className="text-right">Diferença</th><th>Situação</th></tr></thead>
          <tbody>
            {v.history.slice(0, 6).map((h) => (
              <tr key={h.competence}>
                <td>{h.competence}</td>
                <td className="text-xs">{h.budgetSource === "VERSION" ? <Badge tone="navy">versão {h.budgetVersion}</Badge> : <span className="text-navy-500">premissas atuais</span>}</td>
                <td className="tabular text-right">{brl(h.budget)}</td>
                <td className="tabular text-right text-xs text-navy-600">{signed(h.budgetDelta)}</td>
                <td className="tabular text-right">{h.actual ? brl(h.actual) : "—"}</td>
                <td className="tabular text-right text-xs text-navy-600">{signed(h.actualDelta)}</td>
                <td className="tabular text-right">{h.variance ? brl(h.variance) : "—"}</td>
                <td>{h.state === "OVER" ? <Badge tone="red">acima do orçado</Badge> : h.state === "WITHIN" ? <Badge tone="green">dentro</Badge> : <Badge>sem lançamento</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {thisMonth && <p className="px-5 py-3 text-xs text-navy-500">Mês atual ({thisMonth.competence}): {thisMonth.byCategory.length ? thisMonth.byCategory.map((c) => `${COST_CATEGORY_LABEL[c.category]} ${brl(c.amount)}`).join(" · ") : "nenhum lançamento"}.</p>}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Orçamento por competência" description="Congele o orçamento do mês: a comparação com o realizado passa a usar essa versão, mesmo que as premissas mudem depois." />
          {canWrite && (
            <CardBody>
              <ActionForm action={freezeBudgetAction} submitLabel="Congelar orçamento do mês" variant="secondary" confirm="Congelar o orçamento com as premissas atuais? Uma versão anterior do mesmo mês fica como substituída (histórico mantido).">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Competência" htmlFor="freeze-competence"><Input id="freeze-competence" name="competence" type="month" required defaultValue={v.history[0]?.competence} /></Field>
                  <Field label="Postos considerados" htmlFor="freeze-stations" hint="Vazio = produção atual."><Input id="freeze-stations" name="stations" type="number" min={0} max={9999} /></Field>
                  <Field label="Motivo" htmlFor="freeze-reason"><Input id="freeze-reason" name="reason" required minLength={5} maxLength={500} placeholder="Ex.: orçamento aprovado em reunião" /></Field>
                </div>
              </ActionForm>
            </CardBody>
          )}
          <Table>
            <thead><tr><th>Competência</th><th>Versão</th><th className="text-right">Postos</th><th className="text-right">Total/mês</th><th>Motivo</th></tr></thead>
            <tbody>
              {versions.length === 0 && <tr><td colSpan={5} className="text-navy-500">Nenhum mês congelado ainda: o realizado é comparado às premissas atuais.</td></tr>}
              {versions.map((b) => (
                <tr key={b.id} className={b.status === "SUPERSEDED" ? "text-navy-400" : undefined}>
                  <td>{b.competence}</td><td>v{b.version} {b.status === "ACTIVE" ? <Badge tone="green">ativa</Badge> : <Badge>substituída</Badge>}</td>
                  <td className="tabular text-right">{num(b.stations)}</td><td className="tabular text-right">{brl(b.totalMonthly.toString())}</td><td className="text-xs">{b.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card id="importacao" className="scroll-mt-24">
          <CardHeader title="Importar nova versão da planilha" description="Mesmo layout da WeMob_Custos_Mensais_Detalhados.xlsx. Só os valores de entrada são lidos (nenhuma fórmula é executada); você vê a diferença antes de aplicar." />
          <CardBody className="space-y-4">
            {canWrite && (
              <ActionForm action={previewCostImportAction} submitLabel="Ler e pré-visualizar" variant="secondary">
                <Field label="Planilha (.xlsx, até 1 MB)" htmlFor="file"><Input id="file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></Field>
              </ActionForm>
            )}
            {imp && (
              <div className="rounded-lg border border-navy-200 p-4">
                <p className="text-sm font-medium text-navy-900">{imp.import.filename} <span className="text-xs text-navy-500">· sha256 {imp.import.sha256.slice(0, 12)}… · {dateTime(imp.import.createdAt)}</span></p>
                <p className="mt-1 text-sm text-navy-700">Total mensal com {imp.stations} posto(s): <b className="tabular">{brl(imp.current)}</b> → <b className="tabular">{brl(imp.next)}</b></p>
                <ul className="mt-2 space-y-1 text-xs">
                  {imp.diff.map((d) => (
                    <li key={d.name} className="flex justify-between gap-2">
                      <span>{d.name} {d.change === "NEW" ? <Badge tone="green">novo</Badge> : d.change === "CHANGED" ? <Badge tone="amber">alterado</Badge> : null}</span>
                      <span className="tabular text-navy-600">{d.before && d.change !== "SAME" ? `${brl(d.before.baseMonthly)} → ` : ""}{brl(d.after.baseMonthly)} · {pct(d.after.fxExposure, 0)} dólar</span>
                    </li>
                  ))}
                  {imp.removed.map((n) => <li key={n} className="text-red-700">{n} <Badge tone="red">sai do orçamento</Badge></li>)}
                </ul>
                <p className="mt-2 text-xs text-navy-600">Premissas: câmbio {pct(imp.data.assumptions.fxStressRate, 0)} · reserva {pct(imp.data.assumptions.reserveRate, 0)} · por posto {brl(imp.data.assumptions.perStationCost)} + {brl(imp.data.assumptions.perStationReserve)}</p>
                {imp.import.status === "PREVIEW" && canWrite ? (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <ActionForm action={applyCostImportAction} submitLabel="Aplicar ao orçamento" confirm="Aplicar esta versão da planilha? Itens e premissas atuais serão substituídos (meses já congelados não mudam).">
                      <input type="hidden" name="id" value={imp.import.id} />
                      <Field label="Motivo" htmlFor="import-reason"><Input id="import-reason" name="reason" required minLength={5} maxLength={300} placeholder="Ex.: revisão de fornecedores de novembro" /></Field>
                    </ActionForm>
                    <ActionForm action={discardCostImportAction} submitLabel="Descartar" variant="secondary"><input type="hidden" name="id" value={imp.import.id} /></ActionForm>
                  </div>
                ) : (
                  <p className="mt-3 text-xs font-medium text-navy-700">Situação: {imp.import.status === "APPLIED" ? "aplicada" : imp.import.status === "DISCARDED" ? "descartada" : "prévia"}</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Histórico de alterações" description="Quem mudou o quê no orçamento (auditoria)." />
        <Table>
          <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead>
          <tbody>
            {changes.length === 0 && <tr><td colSpan={3} className="text-navy-500">Nenhuma alteração registrada.</td></tr>}
            {changes.map((c) => <tr key={c.id}><td className="text-xs">{dateTime(c.createdAt)}</td><td className="text-xs">{c.actorName}</td><td className="text-sm">{ACTION_LABEL[c.action] ?? c.action}</td></tr>)}
          </tbody>
        </Table>
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
