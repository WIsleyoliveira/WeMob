import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listPayments, PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { activeProvider } from "@/server/payments/registry";
import { reconcileAction } from "@/app/actions/payments";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/app/action-form";
import { brl, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PagamentosPage() {
  const ctx = await requirePage("payment:read");
  const payments = await listPayments(ctx);
  const provider = activeProvider();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Pagamentos" description="Status sincronizado somente com o provedor (consulta ou webhook assinado). Valores do ambiente de testes não são receita." />
      <Alert tone={provider.status === "configured" ? "warning" : "info"} className="mb-6" title={`Provedor: ${provider.status === "configured" ? `${provider.name} (${provider.environment === "SANDBOX" ? "SANDBOX — simulado, sem dinheiro real" : "produção"})` : "não configurado"}`}>
        {provider.status === "configured" ? "Pagamentos de estações de teste usam o sandbox. Estações de produção continuam bloqueadas até um gateway real ser contratado e integrado." : "Nenhum gateway contratado. Recargas pagas estão indisponíveis; somente a demonstração (sem cobrança) funciona."}
      </Alert>
      {ctx.permissions.has("payment:reconcile") && (
        <Card className="mb-6">
          <CardHeader title="Conciliação" description="Confere sessões encerradas × pagamentos × status no provedor. Pagamentos que conferem são marcados como conciliados." />
          <CardBody>
            <ActionForm action={reconcileAction} submitLabel="Conciliar período" pendingLabel="Conciliando…">
              <div className="flex flex-wrap gap-3">
                <label className="text-sm text-navy-700">De <Input type="date" name="de" defaultValue={monthAgo} className="mt-1 w-40" /></label>
                <label className="text-sm text-navy-700">Até <Input type="date" name="ate" defaultValue={today} className="mt-1 w-40" /></label>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
      {payments.length === 0 ? <EmptyState title="Nenhum pagamento registrado" /> : (
        <Card>
          <Table>
            <thead><tr><th>Criado</th><th>Motorista</th><th>Status</th><th className="text-right">Reservado</th><th className="text-right">Capturado</th><th className="text-right">Reembolsado</th><th>Sessão</th><th>Conciliado</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-xs"><Link className="text-brand-700 hover:underline" href={`/app/pagamentos/${p.id}`}>{dateTime(p.createdAt)}</Link> {p.environment === "SANDBOX" && <Badge tone="amber">sandbox</Badge>}</td>
                  <td>{p.driver.name}</td>
                  <td><Badge tone={p.status === "CAPTURED" ? "green" : ["FAILED", "DISPUTED"].includes(p.status) ? "red" : "neutral"}>{PAYMENT_STATUS_LABEL[p.status]}</Badge></td>
                  <td className="tabular text-right">{brl(p.amountAuthorized.toString())}</td>
                  <td className="tabular text-right">{brl(p.amountCaptured.toString())}</td>
                  <td className="tabular text-right">{brl(p.amountRefunded.toString())}</td>
                  <td className="text-xs">{p.session ? `#${p.session.transactionId} · ${p.session.amount ? brl(p.session.amount.toString()) : "em andamento"}` : <span className="text-amber-700">sem sessão</span>}</td>
                  <td className="text-xs">{p.reconciledAt ? dateTime(p.reconciledAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
