import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getPayment, PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { refundAction, resolveReviewAction } from "@/app/actions/payments";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PagamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("payment:read");
  const p = await getPayment(ctx, (await params).id).catch(() => notFound());
  const available = Number(p.amountCaptured) - Number(p.amountRefunded);
  const canRefund = ctx.permissions.has("payment:refund") && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) && available > 0;
  const reviewOpen = !!p.reviewOpenedAt && !p.reviewResolvedAt;
  const isPix = p.method === "PIX";
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pagamentos", href: "/app/pagamentos" }, { label: p.id.slice(-8) }]}
        title={`Pagamento ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}`}
        description={<span className="flex flex-wrap gap-2">{p.environment === "SANDBOX" && <Badge tone="amber">sandbox — sem dinheiro real</Badge>} {reviewOpen && <Badge tone="red">em análise</Badge>} {p.provider} · {p.method} · ref. {p.providerRef} · {p.driver.name} ({p.driver.email})</span>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {reviewOpen && (
            <Alert tone="danger" title="Situação financeira em análise">
              {p.reviewReason} <span className="block text-xs">Aberta em {dateTime(p.reviewOpenedAt!)}. Ajustes e estornos exigem decisão humana; nada é corrigido automaticamente.</span>
            </Alert>
          )}
          {p.reviewResolvedAt && <Alert tone="info" title="Análise encerrada">{p.reviewNote} <span className="block text-xs">{dateTime(p.reviewResolvedAt)}</span></Alert>}
          <Card>
            <CardHeader title="Valores" description={isPix ? "Pix é pré-pago: o valor é cobrado integralmente; a diferença não consumida é estornada ao final." : undefined} />
            <Table><tbody>
              <tr><td>{isPix ? "Cobrado (Pix)" : "Reservado (pré-autorização)"}</td><td className="tabular text-right">{brl(p.amountAuthorized.toString())}</td></tr>
              <tr><td>{isPix ? "Recebido" : "Capturado"}</td><td className="tabular text-right">{brl(p.amountCaptured.toString())}</td></tr>
              <tr><td>Líquido informado pelo gateway</td><td className="tabular text-right">{p.netValue ? brl(p.netValue.toString()) : "—"}</td></tr>
              <tr><td>Tarifa do gateway</td><td className="tabular text-right">{p.feeAmount ? brl(p.feeAmount.toString()) : "—"}</td></tr>
              <tr><td>Reembolsado</td><td className="tabular text-right">{brl(p.amountRefunded.toString())}</td></tr>
              <tr><td>Valor apurado na sessão</td><td className="tabular text-right">{p.session?.amount ? brl(p.session.amount.toString()) : "—"}</td></tr>
              <tr><td>Conciliado</td><td className="text-right">{p.reconciledAt ? dateTime(p.reconciledAt) : "não"}</td></tr>
              <tr><td>Status no gateway · última consulta</td><td className="text-right text-xs">{p.remoteStatus ?? "—"} · {p.lastSyncedAt ? dateTime(p.lastSyncedAt) : "—"}</td></tr>
              <tr><td>Chave idempotente</td><td className="break-all text-right font-mono text-xs">{p.externalReference ?? "—"}</td></tr>
            </tbody></Table>
          </Card>
          <Card>
            <CardHeader title="Split" description={p.splitPolicyVersion ? `Política v${p.splitPolicyVersion} copiada na criação da cobrança (não muda depois). Valores efetivos informados pelo gateway.` : "Cobrança sem split: repasse ao parceiro pelo fechamento mensal."} />
            {p.splits.length > 0 && (
              <Table className="text-xs">
                <thead><tr><th>Carteira</th><th className="text-right">Regra</th><th className="text-right">Valor (gateway)</th><th>Status</th></tr></thead>
                <tbody>
                  {p.splits.map((x) => (
                    <tr key={x.id}>
                      <td className="font-mono">{x.walletId.slice(0, 8)}…</td>
                      <td className="text-right">{x.percentualValue ? `${x.percentualValue}% líq.` : ""}{x.fixedValue ? ` R$ ${x.fixedValue}` : ""}</td>
                      <td className="tabular text-right">{x.totalValue ? brl(x.totalValue.toString()) : "a apurar"}</td>
                      <td><Badge tone={x.status === "DONE" ? "green" : ["CANCELLED", "BLOCKED_BY_VALUE_DIVERGENCE", "REFUNDED"].includes(x.status) ? "red" : "neutral"}>{x.status === "DONE" ? "liquidado" : x.status}</Badge>{x.cancellationReason && <span className="block">{x.cancellationReason}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Eventos do provedor (webhooks)" description="Únicos por id do evento; reentregas não são reprocessadas." />
            <Table className="text-xs">
              <thead><tr><th>Recebido</th><th>Tipo</th><th>Resultado</th><th className="text-right">Tentativas</th></tr></thead>
              <tbody>
                {p.events.map((e) => <tr key={e.id}><td>{dateTime(e.receivedAt)}</td><td>{e.type}</td><td>{e.outcome ?? "pendente"}</td><td className="tabular text-right">{e.attempts}</td></tr>)}
                {p.events.length === 0 && <tr><td colSpan={4} className="text-navy-500">Nenhum webhook recebido; status obtido por consulta direta.</td></tr>}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Reembolsos" />
            <Table className="text-xs">
              <thead><tr><th>Solicitado</th><th className="text-right">Valor</th><th>Status</th><th>Motivo</th></tr></thead>
              <tbody>
                {p.refunds.map((r) => <tr key={r.id}><td>{dateTime(r.createdAt)}</td><td className="tabular text-right">{brl(r.amount.toString())}</td><td>{r.status === "SUCCEEDED" ? "concluído" : r.status === "FAILED" ? "falhou" : "aguardando gateway"}{r.remoteStatus ? ` (${r.remoteStatus})` : ""}</td><td>{r.reason}</td></tr>)}
                {p.refunds.length === 0 && <tr><td colSpan={4} className="text-navy-500">Nenhum reembolso.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
        {reviewOpen && ctx.permissions.has("payment:review") && (
          <Card>
            <CardHeader title="Encerrar análise" description="Registre a análise e a providência tomada (estorno, ajuste no fechamento, contato com o motorista)." />
            <CardBody>
              <ActionForm action={resolveReviewAction} submitLabel="Encerrar análise" variant="secondary">
                <input type="hidden" name="paymentId" value={p.id} />
                <Textarea name="note" required minLength={10} aria-label="Análise e providência" />
              </ActionForm>
            </CardBody>
          </Card>
        )}
        {canRefund && (
          <Card>
            <CardHeader title="Reembolsar" description={`Disponível: ${brl(available.toFixed(2))}. Confirmado somente quando o provedor aceitar.`} />
            <CardBody>
              <ActionForm action={refundAction} submitLabel="Solicitar reembolso" variant="danger" confirm="Solicitar reembolso ao provedor? A operação é registrada e não pode ser desfeita.">
                <input type="hidden" name="paymentId" value={p.id} />
                <Field label="Valor (R$)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" required /></Field>
                <Field label="Motivo" htmlFor="reason"><Input id="reason" name="reason" required minLength={5} /></Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}
        </div>
      </div>
    </>
  );
}
