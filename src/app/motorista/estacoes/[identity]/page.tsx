import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, Clock, MapPin, Navigation } from "lucide-react";
import { getDriver } from "@/server/drivers/current";
import { getDriverStation, listMyVehicles } from "@/server/drivers/service";
import { CONNECTOR_LABEL, compatibleVehicles } from "@/domain/stations/discovery";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl, dateTime } from "@/lib/format";
import { StartForm } from "../../start-form";
import { paymentOptions, purchaseOptions } from "@/server/drivers/charging";

export const dynamic = "force-dynamic";

const STEPS = ["Escolha o conector", "Defina a recarga", "Pague", "Acompanhe"];

export default async function DriverStationPage({ params }: { params: Promise<{ identity: string }> }) {
  const identity = decodeURIComponent((await params).identity);
  const s = await getDriverStation(identity).catch(() => notFound());
  const driver = await getDriver();
  const vehicles = await listMyVehicles(driver);
  const demo = s.environment === "SIMULATED";
  const pay = paymentOptions();
  const purchase = purchaseOptions(s.environment);
  const maps = s.site.latitude && s.site.longitude ? `https://www.google.com/maps/search/?api=1&query=${s.site.latitude},${s.site.longitude}` : null;
  const address = [s.site.address, s.site.city && `${s.site.city}/${s.site.state ?? ""}`].filter(Boolean).join(" · ");
  const purchaseInput = !demo && purchase.enabled && s.tariff
    ? { min: purchase.min, max: purchase.max, suggested: purchase.suggested, shortcuts: purchase.shortcuts, example: purchase.example, margin: purchase.margin, pricePerKwh: s.tariff.pricePerKwh.toString(), pricePerMin: s.tariff.pricePerMin.toString(), prepaid: pay.prepaid }
    : undefined;
  const paymentText = demo
    ? "Na demonstração nada é cobrado."
    : purchaseInput
      ? pay.prepaid
        ? `Você escolhe quanto quer gastar (entre ${brl(purchaseInput.min)} e ${brl(purchaseInput.max)}). O valor é cobrado antes do início; ao final você paga só o que consumiu e a diferença volta por estorno — no cartão, pode levar até 10 dias úteis para aparecer na fatura.`
        : `Você escolhe quanto quer reservar (entre ${brl(purchaseInput.min)} e ${brl(purchaseInput.max)}). Ao final é cobrado só o valor apurado e o restante da reserva é liberado.`
      : pay.prepaid
        ? `Antes do início cobramos ${brl(pay.amount)} (valor máximo da recarga). Ao final você paga só o que consumiu: a diferença volta por estorno — no cartão, pode levar até 10 dias úteis para aparecer na fatura.`
        : "Antes do início é feita uma reserva (pré-autorização) no meio de pagamento; ao final é cobrado só o valor apurado e o restante é liberado.";
  return (
    <>
      <p className="text-sm"><Link href={demo ? "/motorista?modo=demo" : "/motorista"} className="font-medium text-navy-600">← Estações</Link></p>

      <header className="mt-2">
        <h1 className="font-display text-2xl font-semibold text-navy-900">{s.site.name}</h1>
        {address && <p className="mt-0.5 flex items-start gap-1.5 text-sm text-navy-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{address}</p>}
        {s.site.openingHours && <p className="mt-0.5 flex items-center gap-1.5 text-sm text-navy-600"><Clock className="size-4 shrink-0" aria-hidden />{s.site.openingHours}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-xl bg-navy-900 px-3 py-2 text-white">
            <span className="block text-[11px] uppercase tracking-wide text-navy-200">Preço</span>
            <span className="tabular font-display text-lg font-semibold">{s.tariff ? `${brl(s.tariff.pricePerKwh.toString())}/kWh` : "sem tarifa"}</span>
            {s.tariff && Number(s.tariff.pricePerMin) > 0 && <span className="block text-xs text-navy-200">+ {brl(s.tariff.pricePerMin.toString())} por minuto</span>}
          </span>
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-navy-200 bg-white px-3 text-sm font-medium text-navy-800 hover:border-navy-300">
              <Navigation className="size-4" aria-hidden />Como chegar <span className="sr-only">(abre o mapa em outro site)</span>
            </a>
          )}
        </div>
        {s.tariff && <p className="mt-1.5 text-xs text-navy-500">Tarifa vigente desde {dateTime(s.tariff.validFrom)}.</p>}
      </header>

      {demo && <Alert tone="warning" className="mt-3" title="Demonstração">Estação simulada: sem cobrança e sem fornecimento real de energia.</Alert>}

      <ol className="mt-5 grid grid-cols-4 gap-1 text-center text-[11px] font-medium text-navy-600" aria-label="Etapas da recarga">
        {STEPS.map((t, i) => (
          <li key={t} className="flex flex-col items-center gap-1">
            <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-brand-600 text-white" : "bg-navy-100 text-navy-600"}`} aria-hidden>{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>

      <section className="mt-5 flex flex-col gap-3" aria-labelledby="conectores">
        <h2 id="conectores" className="font-display text-lg font-semibold text-navy-900">Escolha o conector</h2>
        {!s.fresh && <Alert tone="warning">Sem comunicação recente com a estação. A disponibilidade é desconhecida e o início pelo app fica bloqueado.</Alert>}
        {s.connectors.map((c) => {
          const can = s.fresh && ["AVAILABLE", "PREPARING"].includes(c.status) && !!s.tariff;
          const ok = vehicles.length > 0 ? compatibleVehicles(c, vehicles) : null;
          return (
            <article key={c.connectorId} className={`rounded-2xl border bg-white p-4 shadow-[var(--shadow-card)] ${can ? "border-brand-200" : "border-navy-100"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-navy-900">Conector {c.connectorId} · {CONNECTOR_LABEL[c.type]}</p>
                  <p className="text-sm text-navy-600">{Number(c.maxPowerKw) > 0 ? `até ${c.maxPowerKw} kW (potência máxima do carregador)` : "potência não informada"}</p>
                </div>
                <ConnectorStatusBadge status={c.status} />
              </div>
              <p className="mt-1 text-xs text-navy-500">{c.statusReceivedAt ? `Situação informada pelo carregador em ${dateTime(c.statusReceivedAt)}` : "O carregador ainda não informou a situação"}</p>
              {ok && (
                <p className="mt-1 text-xs text-navy-700">
                  {ok.length > 0 ? `Compatível com ${ok.map((v) => v.label).join(", ")} pelo tipo de conector.` : `Nenhum veículo seu cadastrado com conector ${CONNECTOR_LABEL[c.type]}.`}
                  <span className="text-navy-500"> A potência aceita pelo veículo não é verificada.</span>
                </p>
              )}
              <div className="mt-4">
                {driver ? (
                  <StartForm identity={s.identity} connectorId={c.connectorId} label={can ? (demo ? "Iniciar recarga (demonstração)" : "Iniciar recarga") : "Indisponível no momento"} disabled={!can} methods={demo ? [] : pay.methods} purchase={can ? purchaseInput : undefined} />
                ) : (
                  <ButtonLink href={`/motorista/entrar?voltar=${encodeURIComponent(`/motorista/estacoes/${s.identity}`)}`} className="w-full" size="lg">Entrar para carregar</ButtonLink>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="mt-5 flex flex-col gap-2">
        <details className="group rounded-xl border border-navy-100 bg-white text-sm" open={!driver}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium text-navy-900 [&::-webkit-details-marker]:hidden">
            Como funciona o pagamento
            <ChevronDown className="size-4 shrink-0 text-navy-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="px-4 pb-4 leading-relaxed text-navy-600">{paymentText}</p>
        </details>
        <details className="group rounded-xl border border-navy-100 bg-white text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium text-navy-900 [&::-webkit-details-marker]:hidden">
            Como carregar, passo a passo
            <ChevronDown className="size-4 shrink-0 text-navy-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ol className="grid gap-3 px-4 pb-4 text-navy-700">
            {["Estacione e conecte o cabo ao veículo.", demo ? "Toque em iniciar no conector que você usou." : "Escolha o valor (quando disponível) e a forma de pagamento, e toque em iniciar no conector que você usou.", "Acompanhe pelo app. Encerre pelo app ou pelo próprio veículo — você paga só o que consumiu."].map((t, i) => (
              <li key={i} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700" aria-hidden>{i + 1}</span>{t}</li>
            ))}
          </ol>
        </details>
      </section>
    </>
  );
}
