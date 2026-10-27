import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDriverPage } from "@/server/drivers/current";
import { getMySession } from "@/server/drivers/service";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { rateSessionAction, stopChargeAction } from "@/app/actions/driver";
import { Alert } from "@/components/ui/alert";
import { Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { brl, dateTime, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RecargaPage({ params }: { params: Promise<{ id: string }> }) {
  const driver = await requireDriverPage();
  const v = await getMySession(driver, (await params).id).catch(() => notFound());
  const s = v.session;
  const live = s.status !== "COMPLETED";
  const paid = v.payment && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(v.payment.status);
  return (
    <>
      {live && <AutoRefresh ms={5000} />}
      <p className="text-sm"><Link href="/motorista/historico" className="text-navy-500">← Recargas</Link></p>
      <h1 className="mt-2 font-display text-xl font-semibold text-navy-900">{live ? "Recarga em andamento" : "Recarga encerrada"}</h1>
      <p className="text-sm text-navy-500">{s.station.site.name} · conector {s.connectorId} · transação {s.transactionId}</p>
      {v.demo && <Alert tone="warning" className="mt-3" title="Demonstração">Sem cobrança. Valores ilustrativos de uma estação simulada.</Alert>}
      {s.status === "COMMUNICATION_LOST" && <Alert tone="danger" className="mt-3" title="Carregador sem comunicação">Os valores abaixo são parciais. O total será apurado quando o carregador reconectar e informar o encerramento.</Alert>}

      <div className="mt-4 grid grid-cols-2 gap-3" aria-live="polite">
        <div className="rounded-xl border border-navy-100 bg-white p-4"><p className="text-xs text-navy-500">Energia</p><p className="tabular font-display text-2xl font-semibold">{num(v.energyKwh, 2)} kWh</p></div>
        <div className="rounded-xl border border-navy-100 bg-white p-4"><p className="text-xs text-navy-500">Duração</p><p className="tabular font-display text-2xl font-semibold">{num(v.minutes, 0)} min</p></div>
        <div className="col-span-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs text-navy-600">{v.amountKind === "ESTIMATED" ? "Custo estimado (atualiza durante a recarga)" : "Valor apurado"}</p>
          <p className="tabular font-display text-3xl font-semibold text-navy-900">{brl(v.amount)}</p>
          <p className="mt-1 text-xs text-navy-500">
            Tarifa congelada no início: {s.tariffPricePerKwh ? `${brl(s.tariffPricePerKwh.toString())}/kWh` : "—"}{s.tariffPricePerMin && Number(s.tariffPricePerMin) > 0 ? ` + ${brl(s.tariffPricePerMin.toString())}/min` : ""}.
            {v.amountKind === "ESTIMATED" && " Pode variar até o encerramento."}
          </p>
        </div>
      </div>
      {v.lastPowerW !== null && live && <p className="mt-2 text-xs text-navy-500">Potência na última medição: {num(v.lastPowerW / 1000, 1)} kW</p>}

      {!v.demo && (
        <p className="mt-3 text-sm">
          Pagamento: {v.payment ? <b>{PAYMENT_STATUS_LABEL[v.payment.status]}</b> : <b>não registrado</b>}
          {paid && v.payment && ` — cobrado ${brl(v.payment.amountCaptured.toString())}${Number(v.payment.amountRefunded) > 0 ? `, reembolsado ${brl(v.payment.amountRefunded.toString())}` : ""}`}
          {!paid && !live && " — o valor será confirmado após o processamento pelo provedor."}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {s.status === "ACTIVE" && (
          <ActionForm action={stopChargeAction} submitLabel="Encerrar recarga" variant="danger" confirm="Encerrar a recarga agora?">
            <input type="hidden" name="sessionId" value={s.id} />
          </ActionForm>
        )}
        {!live && <Link className="text-center text-sm font-medium text-brand-700 underline" href={`/motorista/recibo/${s.id}`}>Ver recibo</Link>}
        {!live && (
          <section className="rounded-xl border border-navy-100 bg-white p-4">
            <h2 className="font-display font-semibold text-navy-900">Avalie esta recarga</h2>
            {s.rating && <p className="text-sm text-navy-500">Sua avaliação: {s.rating.stars}/5</p>}
            <ActionForm action={rateSessionAction} submitLabel={s.rating ? "Atualizar avaliação" : "Enviar avaliação"} variant="secondary" size="sm" className="mt-2">
              <input type="hidden" name="sessionId" value={s.id} />
              <Select name="stars" defaultValue={String(s.rating?.stars ?? 5)} aria-label="Nota">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} estrela{n > 1 ? "s" : ""}</option>)}</Select>
              <Textarea name="comment" maxLength={500} placeholder="Comentário (opcional)" aria-label="Comentário" defaultValue={s.rating?.comment ?? ""} />
            </ActionForm>
          </section>
        )}
        <p className="text-xs text-navy-500">Início {dateTime(s.startedAt)}{s.stoppedAt ? ` · fim ${dateTime(s.stoppedAt)}` : ""}</p>
      </div>
    </>
  );
}
