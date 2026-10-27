import { requirePage } from "@/server/auth/current";
import { getClosing } from "@/server/modules/finance/closing";
import { financeFormOptions, CATEGORY_LABEL, ENTRY_STATUS_LABEL, KIND_LABEL } from "@/server/modules/finance/entries";
import { approveClosingAction, createAdjustmentAction, rejectClosingAction } from "@/app/actions/finance";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { SettlementTable } from "@/components/app/settlement-table";
import { brl, date, dateTime } from "@/lib/format";
import { CLOSING_STATUS_LABEL } from "../../labels";

export const dynamic = "force-dynamic";

export default async function ClosingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("finance:read");
  const c = await getClosing(ctx, (await params).id);
  const opts = await financeFormOptions(ctx);
  const t = c.result.totals;
  const name = (id: string | null) => (id ? c.userNames[id] ?? id : "—");
  const canDecide = c.status === "PENDING_APPROVAL" && ctx.permissions.has("finance:approve");
  return (
    <>
      <PageHeader
        title={`Fechamento ${c.period}`}
        breadcrumbs={[{ label: "Financeiro", href: "/app/financeiro" }, { label: "Fechamento", href: "/app/financeiro/fechamento" }, { label: c.period }]}
        description={<>Solicitado por {name(c.requestedById)} em {dateTime(c.requestedAt)}{c.decidedAt && <> · decidido por {name(c.decidedById)} em {dateTime(c.decidedAt)}</>}{c.decisionNote && <> · “{c.decisionNote}”</>}</>}
        actions={<Badge tone={c.status === "APPROVED" ? "green" : c.status === "PENDING_APPROVAL" ? "amber" : "neutral"}>{CLOSING_STATUS_LABEL[c.status]}</Badge>}
      />
      <Alert tone={c.hashValid ? "info" : "danger"} className="mb-6" title={c.hashValid ? "Registro íntegro" : "ATENÇÃO: o registro não confere com o hash"}>
        Resultado {c.status === "APPROVED" ? "aprovado e imutável" : "registrado na solicitação"} · motor {c.engineVersion} · SHA-256 <code className="break-all text-xs">{c.resultHash}</code>
      </Alert>
      {c.validations.warnings.map((w) => <Alert key={w} tone="warning" className="mb-3">{w}</Alert>)}
      {canDecide && (
        <Card className="mb-6">
          <CardHeader title="Decisão" description="A aprovação recalcula o período; se algum dado mudou desde a solicitação, o pedido é marcado como superado." />
          <CardBody className="grid gap-6 md:grid-cols-2">
            {c.requestedById === ctx.userId ? <Alert tone="info">Você solicitou este fechamento: a aprovação deve ser feita por outra pessoa autorizada.</Alert> : (
              <ActionForm action={approveClosingAction} submitLabel="Aprovar fechamento" confirm={`Aprovar o fechamento de ${c.period}? O resultado ficará imutável e os repasses serão provisionados.`}>
                <input type="hidden" name="closingId" value={c.id} />
                <Field label="Observação (opcional)" htmlFor="note-a"><Input id="note-a" name="note" maxLength={500} /></Field>
              </ActionForm>
            )}
            <ActionForm action={rejectClosingAction} submitLabel="Recusar" variant="danger">
              <input type="hidden" name="closingId" value={c.id} />
              <Field label="Motivo da recusa" htmlFor="note-r" required><Input id="note-r" name="note" required minLength={5} maxLength={500} /></Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
      <Card className="mb-6">
        <CardHeader title="Resultado" description={`Bruto ${brl(t.gross)} · Royalties ${brl(t.royalty)} · Repasses ${brl(t.partnerShare)} · Resultado da rede ${brl(t.networkResult)}`} />
        <SettlementTable lines={c.result.lines} showStations />
      </Card>
      {c.entries.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Repasses e aportes gerados" description="Provisionados na aprovação; a baixa é registrada em Contas a pagar e receber após o pagamento pelo banco." />
          <Table>
            <thead><tr><th>Descrição</th><th>Sentido</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
            <tbody>{c.entries.map((e) => <tr key={e.id}><td>{e.description}</td><td>{KIND_LABEL[e.kind]}</td><td>{e.dueDate ? date(e.dueDate) : "—"}</td><td><Badge tone={e.status === "PAID" ? "green" : "amber"}>{ENTRY_STATUS_LABEL[e.status]}</Badge></td><td className="tabular text-right">{brl(e.amount.toString())}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      {c.status === "APPROVED" && (
        <Card>
          <CardHeader title="Ajustes posteriores" description="Correções de período fechado: lançadas no período aberto atual, ligadas a este fechamento. O resultado acima não é alterado." />
          {c.adjustments.length > 0 && (
            <Table>
              <thead><tr><th>Lançado em</th><th>Parceiro</th><th>Descrição</th><th>Sentido</th><th className="text-right">Valor</th></tr></thead>
              <tbody>{c.adjustments.map((a) => <tr key={a.id}><td className="text-xs">{dateTime(a.createdAt)} ({a.competence})</td><td>{a.partnerOrganization?.name}</td><td>{a.description}</td><td>{KIND_LABEL[a.kind]} · {CATEGORY_LABEL[a.category]}</td><td className="tabular text-right">{brl(a.amount.toString())}</td></tr>)}</tbody>
            </Table>
          )}
          {ctx.permissions.has("finance:close") && (
            <CardBody className="border-t border-navy-100">
              <ActionForm action={createAdjustmentAction} submitLabel="Lançar ajuste" confirm="Lançar ajuste referente a período fechado? Ele fica registrado na auditoria e no extrato do parceiro.">
                <input type="hidden" name="adjustsPeriod" value={c.period} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Contrato" htmlFor="contractId" required><Select id="contractId" name="contractId" required>{opts.contracts.map((k) => <option key={k.id} value={k.id}>{k.number} · {k.partnerOrganization.name}</option>)}</Select></Field>
                  <Field label="Sentido" htmlFor="kind" required><Select id="kind" name="kind"><option value="PAYABLE">A pagar ao parceiro</option><option value="RECEIVABLE">A receber do parceiro</option></Select></Field>
                  <Field label="Valor (R$)" htmlFor="amount" required><Input id="amount" name="amount" type="number" step="0.01" min="0.01" required /></Field>
                </div>
                <Field label="Motivo do ajuste" htmlFor="description" required><Textarea id="description" name="description" required minLength={10} maxLength={500} /></Field>
              </ActionForm>
            </CardBody>
          )}
        </Card>
      )}
    </>
  );
}
