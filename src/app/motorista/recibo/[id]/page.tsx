import { notFound } from "next/navigation";
import { requireDriverPage } from "@/server/drivers/current";
import { getMySession } from "@/server/drivers/service";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { Logo } from "@/components/ui/logo";
import { PrintButton } from "@/app/app/crm/propostas/[id]/imprimir/print-button";
import { brl, dateTime, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const driver = await requireDriverPage();
  const v = await getMySession(driver, (await params).id).catch(() => notFound());
  const s = v.session;
  if (s.status !== "COMPLETED") notFound();
  const p = v.payment;
  const rows: [string, string][] = [
    ["Estação", `${s.station.site.name} (${s.station.ocppIdentity}) · conector ${s.connectorId}`],
    ["Transação", String(s.transactionId)],
    ["Início · fim", `${dateTime(s.startedAt)} · ${s.stoppedAt ? dateTime(s.stoppedAt) : "—"}`],
    ["Energia", `${num(v.energyKwh, 3)} kWh (medidor ${s.meterStartWh} → ${s.meterStopWh} Wh)`],
    ["Duração", `${num(v.minutes, 0)} min`],
    ["Tarifa", `${s.tariffPricePerKwh ? brl(s.tariffPricePerKwh.toString()) : "—"}/kWh${s.tariffPricePerMin && Number(s.tariffPricePerMin) > 0 ? ` + ${brl(s.tariffPricePerMin.toString())}/min` : ""}`],
    ["Valor apurado", brl(v.amount)],
    ["Pagamento", v.demo ? "Demonstração — sem cobrança" : p ? `${PAYMENT_STATUS_LABEL[p.status]} · cobrado ${brl(p.amountCaptured.toString())}${Number(p.amountRefunded) > 0 ? ` · reembolsado ${brl(p.amountRefunded.toString())}` : ""}${p.environment === "SANDBOX" ? " (ambiente de testes)" : ""}` : "Não registrado"],
  ];
  return (
    <article className="rounded-xl bg-white p-5 print:p-0">
      <div className="flex items-center justify-between"><Logo /><span className="print:hidden"><PrintButton /></span></div>
      <h1 className="mt-4 font-display text-lg font-semibold">Comprovante de recarga</h1>
      {v.demo && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-800">DEMONSTRAÇÃO — sem valor fiscal e sem cobrança</p>}
      <dl className="mt-4 divide-y divide-navy-100 text-sm">
        {rows.map(([k, val]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-navy-500">{k}</dt><dd className="text-right font-medium">{val}</dd></div>)}
      </dl>
      <p className="mt-4 text-xs text-navy-500">Este comprovante não é documento fiscal. A emissão de nota fiscal depende de integração ainda não configurada.</p>
      <p className="mt-3 text-sm print:hidden"><a href={`/motorista/ajuda?sessao=${s.id}&tipo=VALOR_DIVERGENTE#chamado`} className="font-medium text-navy-600 underline">Algo errado neste recibo?</a></p>
    </article>
  );
}
