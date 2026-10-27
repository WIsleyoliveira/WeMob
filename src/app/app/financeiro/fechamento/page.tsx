import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listClosings, previewClosing } from "@/server/modules/finance/closing";
import { requestClosingAction } from "@/app/actions/finance";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { SettlementTable } from "@/components/app/settlement-table";
import { brl, dateTime } from "@/lib/format";
import { CLOSING_STATUS_LABEL, defaultPeriod, isPeriod } from "../labels";

export const dynamic = "force-dynamic";

export default async function FechamentoPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await requirePage("finance:read");
  const sp = await searchParams;
  const period = isPeriod(sp.periodo) ? sp.periodo : defaultPeriod();
  const [p, closings] = await Promise.all([previewClosing(ctx, period), listClosings(ctx)]);
  const t = p.result.totals;
  return (
    <>
      <PageHeader title="Fechamento mensal" description="1. Prévia e validações → 2. Solicitação → 3. Aprovação por outra pessoa autorizada (recalcula e confere o hash) → resultado imutável e repasses provisionados." />
      <form method="get" className="mb-6 flex items-end gap-3">
        <label className="text-sm text-navy-700">Período <Input type="month" name="periodo" defaultValue={period} className="mt-1 w-44" /></label>
        <button className="h-10 rounded-lg border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">Ver prévia</button>
      </form>
      {p.approved && <Alert tone="success" className="mb-4" title={`Período ${period} fechado`}>Aprovado em {dateTime(p.approved.decidedAt!)}. <Link className="underline" href={`/app/financeiro/fechamento/${p.approved.id}`}>Ver resultado registrado</Link>. Correções somente por ajuste.</Alert>}
      {p.pending && <Alert tone="warning" className="mb-4" title="Aguardando aprovação"><Link className="underline" href={`/app/financeiro/fechamento/${p.pending.id}`}>Abrir pedido de fechamento</Link></Alert>}
      <Card className="mb-6">
        <CardHeader title={`Prévia ${period}`} description={<>Calculada agora (não registrada) · motor {p.result.engineVersion} · hash <code className="text-xs">{p.hash.slice(0, 16)}…</code></>} />
        <CardBody className="space-y-3">
          {p.validations.errors.map((e) => <Alert key={e} tone="danger">{e}</Alert>)}
          {p.validations.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
          {p.validations.errors.length === 0 && <Alert tone="success">Nenhum impedimento encontrado.</Alert>}
          <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[["Bruto", t.gross], ["Líquida", t.netRevenue], ["Royalties", t.royalty], ["Repasses", t.partnerShare], ["Despesas da rede", t.networkExpenses], ["Resultado da rede", t.networkResult]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-navy-50/60 px-3 py-2"><dt className="text-xs text-navy-500">{k}</dt><dd className="tabular font-semibold text-navy-900">{brl(v)}</dd></div>
            ))}
          </dl>
        </CardBody>
        <SettlementTable lines={p.result.lines} showStations />
        {ctx.permissions.has("finance:close") && !p.approved && !p.pending && (
          <CardBody className="border-t border-navy-100">
            <ActionForm action={requestClosingAction} submitLabel="Solicitar fechamento" pendingLabel="Registrando…" confirm={`Registrar a prévia de ${period} e enviar para aprovação? Qualquer mudança nos dados antes da aprovação invalida o pedido.`}>
              <input type="hidden" name="period" value={period} />
            </ActionForm>
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader title="Histórico de fechamentos" />
        <CardBody>
          {closings.length === 0 ? <p className="text-sm text-navy-500">Nenhum fechamento.</p> : (
            <ul className="divide-y divide-navy-50 text-sm">
              {closings.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/app/financeiro/fechamento/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.period}</Link>
                  <span className="flex items-center gap-2 text-xs text-navy-500"><Badge tone={c.status === "APPROVED" ? "green" : c.status === "PENDING_APPROVAL" ? "amber" : "neutral"}>{CLOSING_STATUS_LABEL[c.status]}</Badge>{dateTime(c.requestedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
