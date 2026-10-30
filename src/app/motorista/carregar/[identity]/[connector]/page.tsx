import { notFound } from "next/navigation";
import { getDriver } from "@/server/drivers/current";
import { getDriverStation } from "@/server/drivers/service";
import { CONNECTOR_LABEL } from "@/domain/stations/discovery";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl } from "@/lib/format";
import { StartForm } from "../../../start-form";
import { paymentOptions, purchaseOptions } from "@/server/drivers/charging";

export const dynamic = "force-dynamic";

/** Destino do QR Code impresso no carregador: valida estação e conector antes de oferecer o início. */
export default async function QrStartPage({ params }: { params: Promise<{ identity: string; connector: string }> }) {
  const p = await params;
  const identity = decodeURIComponent(p.identity);
  const connectorId = Number(p.connector);
  const s = await getDriverStation(identity).catch(() => notFound());
  const c = s.connectors.find((x) => x.connectorId === connectorId);
  if (!c) notFound();
  const driver = await getDriver();
  const demo = s.environment === "SIMULATED";
  const pay = paymentOptions();
  const purchase = purchaseOptions(s.environment);
  const can = s.fresh && ["AVAILABLE", "PREPARING"].includes(c.status) && !!s.tariff;
  const here = `/motorista/carregar/${encodeURIComponent(identity)}/${connectorId}`;
  const purchaseInput = !demo && can && purchase.enabled && s.tariff
    ? { min: purchase.min, max: purchase.max, suggested: purchase.suggested, shortcuts: purchase.shortcuts, example: purchase.example, margin: purchase.margin, pricePerKwh: s.tariff.pricePerKwh.toString(), pricePerMin: s.tariff.pricePerMin.toString(), prepaid: pay.prepaid }
    : undefined;
  return (
    <>
      <h1 className="font-display text-2xl font-semibold text-navy-900">{s.site.name}</h1>
      <p className="text-sm text-navy-600">Estação {s.identity} · conector {c.connectorId} ({CONNECTOR_LABEL[c.type]}{Number(c.maxPowerKw) > 0 ? `, até ${c.maxPowerKw} kW` : ""})</p>
      {demo && <Alert tone="warning" className="mt-3" title="Demonstração">Sem cobrança e sem energia real.</Alert>}
      <div className="mt-4 rounded-2xl border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between"><span className="text-sm text-navy-600">Situação</span><ConnectorStatusBadge status={c.status} /></div>
        <div className="mt-2 flex items-center justify-between"><span className="text-sm text-navy-600">Preço</span><b className="tabular text-base">{s.tariff ? `${brl(s.tariff.pricePerKwh.toString())}/kWh` : "—"}</b></div>
        {!purchaseInput && (
          <p className="mt-3 border-t border-navy-100 pt-3 text-xs text-navy-500">{demo ? "Na demonstração nada é cobrado." : pay.prepaid ? `Antes do início cobramos ${brl(pay.amount)} (valor máximo da recarga). Ao final você paga só o que consumiu: a diferença volta por estorno — no cartão, pode levar até 10 dias úteis para aparecer na fatura.` : "Antes do início é feita uma reserva (pré-autorização) no meio de pagamento; ao final é cobrado só o valor apurado e o restante é liberado."}</p>
        )}
      </div>
      <div className="mt-4">
        {driver ? <StartForm identity={s.identity} connectorId={c.connectorId} label={can ? "Iniciar recarga" : "Indisponível no momento"} disabled={!can} methods={demo ? [] : pay.methods} purchase={purchaseInput} /> : <ButtonLink href={`/motorista/entrar?voltar=${encodeURIComponent(here)}`} size="lg" className="w-full">Entrar para carregar</ButtonLink>}
      </div>
    </>
  );
}
