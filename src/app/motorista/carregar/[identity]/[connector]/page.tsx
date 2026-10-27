import { notFound } from "next/navigation";
import { getDriver } from "@/server/drivers/current";
import { getDriverStation } from "@/server/drivers/service";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl } from "@/lib/format";
import { StartForm } from "../../../start-form";

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
  const can = s.fresh && ["AVAILABLE", "PREPARING"].includes(c.status) && !!s.tariff;
  const here = `/motorista/carregar/${encodeURIComponent(identity)}/${connectorId}`;
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">{s.site.name}</h1>
      <p className="text-sm text-navy-500">Estação {s.identity} · conector {c.connectorId} ({c.type})</p>
      {s.environment === "SIMULATED" && <Alert tone="warning" className="mt-3" title="Demonstração">Sem cobrança e sem energia real.</Alert>}
      <div className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
        <div className="flex items-center justify-between"><span className="text-sm text-navy-600">Status</span><ConnectorStatusBadge status={c.status} /></div>
        <div className="mt-2 flex items-center justify-between"><span className="text-sm text-navy-600">Tarifa</span><b className="text-sm">{s.tariff ? `${brl(s.tariff.pricePerKwh.toString())}/kWh` : "—"}</b></div>
      </div>
      <div className="mt-4">
        {driver ? <StartForm identity={s.identity} connectorId={c.connectorId} label={can ? "Iniciar recarga" : "Indisponível no momento"} disabled={!can} /> : <ButtonLink href={`/motorista/entrar?voltar=${encodeURIComponent(here)}`} size="lg" className="w-full">Entrar para carregar</ButtonLink>}
      </div>
    </>
  );
}
