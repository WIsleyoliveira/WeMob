import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { entriesSummary } from "@/server/modules/finance/entries";
import { listClosings } from "@/server/modules/finance/closing";
import { payoutProviderStatus } from "@/server/modules/finance/payouts";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl, dateTime } from "@/lib/format";
import { CLOSING_STATUS_LABEL } from "./labels";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const ctx = await requirePage("finance:read");
  const [sum, closings] = await Promise.all([entriesSummary(ctx), listClosings(ctx)]);
  const payout = payoutProviderStatus();
  const now = new Date();
  return (
    <>
      <PageHeader title="Financeiro" description="Contas a pagar e receber, fechamento mensal com aprovação, royalties e repasses calculados pelas condições contratuais aprovadas." />
      <Alert tone="warning" className="mb-6" title="Uso gerencial — não substitui contabilidade nem orientação fiscal">
        Os valores são apurações gerenciais a partir dos dados registrados na plataforma. Tributos são percentuais configurados sobre a receita bruta e não modelam regimes específicos (IRPJ/CSLL, créditos, retenções). Valide com contador habilitado antes de usar para fins contábeis, fiscais ou contratuais.
      </Alert>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="A receber (em aberto)" value={brl(sum.receivableOpen)} definition="Soma dos lançamentos a receber com situação em aberto (provisionados)." source="Lançamentos financeiros" updatedAt={now} />
        <Stat label="Recebido (baixado)" value={brl(sum.receivablePaid)} definition="Soma dos valores baixados como recebidos (registro manual após o recebimento)." source="Lançamentos financeiros" updatedAt={now} />
        <Stat label="A pagar (provisionado)" value={brl(sum.payableOpen)} definition="Soma dos lançamentos a pagar em aberto, incluindo repasses provisionados por fechamentos aprovados." source="Lançamentos financeiros" updatedAt={now} />
        <Stat label="Pago (baixado)" value={brl(sum.payablePaid)} definition="Soma dos valores baixados como pagos. A plataforma não movimenta dinheiro: a baixa registra um pagamento feito fora dela." source="Lançamentos financeiros" updatedAt={now} />
      </div>
      {sum.overdue > 0 && <Alert tone="danger" className="mb-6">{sum.overdue} lançamento(s) em aberto com vencimento ultrapassado. <Link className="underline" href="/app/financeiro/lancamentos?situacao=OPEN">Ver</Link></Alert>}
      <Alert tone="info" className="mb-6" title="Transferências bancárias: não configuradas">{payout.message}</Alert>
      <Card>
        <CardHeader title="Fechamentos" actions={<Link className="text-sm font-medium text-brand-700 hover:underline" href="/app/financeiro/fechamento">Novo fechamento / prévia</Link>} />
        <CardBody>
          {closings.length === 0 ? <p className="text-sm text-navy-500">Nenhum fechamento solicitado ainda.</p> : (
            <ul className="divide-y divide-navy-50 text-sm">
              {closings.slice(0, 12).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/app/financeiro/fechamento/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.period}</Link>
                  <span className="flex items-center gap-2 text-xs text-navy-500"><Badge tone={c.status === "APPROVED" ? "green" : c.status === "PENDING_APPROVAL" ? "amber" : "neutral"}>{CLOSING_STATUS_LABEL[c.status]}</Badge> solicitado {dateTime(c.requestedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
