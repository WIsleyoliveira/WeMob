import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getPayment, PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { refundAction } from "@/app/actions/payments";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PagamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("payment:read");
  const p = await getPayment(ctx, (await params).id).catch(() => notFound());
  const available = Number(p.amountCaptured) - Number(p.amountRefunded);
  const canRefund = ctx.permissions.has("payment:refund") && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) && available > 0;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pagamentos", href: "/app/pagamentos" }, { label: p.id.slice(-8) }]}
        title={`Pagamento ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}`}
        description={<span className="flex flex-wrap gap-2">{p.environment === "SANDBOX" && <Badge tone="amber">sandbox — sem dinheiro real</Badge>} {p.provider} · ref. {p.providerRef} · {p.driver.name} ({p.driver.email})</span>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Valores" />
            <Table><tbody>
              <tr><td>Reservado (pré-autorização)</td><td className="tabular text-right">{brl(p.amountAuthorized.toString())}</td></tr>
              <tr><td>Capturado</td><td className="tabular text-right">{brl(p.amountCaptured.toString())}</td></tr>
              <tr><td>Reembolsado</td><td className="tabular text-right">{brl(p.amountRefunded.toString())}</td></tr>
              <tr><td>Valor apurado na sessão</td><td className="tabular text-right">{p.session?.amount ? brl(p.session.amount.toString()) : "—"}</td></tr>
              <tr><td>Conciliado</td><td className="text-right">{p.reconciledAt ? dateTime(p.reconciledAt) : "não"}</td></tr>
            </tbody></Table>
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
                {p.refunds.map((r) => <tr key={r.id}><td>{dateTime(r.createdAt)}</td><td className="tabular text-right">{brl(r.amount.toString())}</td><td>{r.status}</td><td>{r.reason}</td></tr>)}
                {p.refunds.length === 0 && <tr><td colSpan={4} className="text-navy-500">Nenhum reembolso.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </div>
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
    </>
  );
}
