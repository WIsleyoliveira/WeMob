import Link from "next/link";
import { notFound } from "next/navigation";
import { getDriver } from "@/server/drivers/current";
import { getDriverStation } from "@/server/drivers/service";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl, dateTime } from "@/lib/format";
import { StartForm } from "../../start-form";

export const dynamic = "force-dynamic";

export default async function DriverStationPage({ params }: { params: Promise<{ identity: string }> }) {
  const identity = decodeURIComponent((await params).identity);
  const s = await getDriverStation(identity).catch(() => notFound());
  const driver = await getDriver();
  const demo = s.environment === "SIMULATED";
  const maps = s.site.latitude && s.site.longitude ? `https://www.google.com/maps/search/?api=1&query=${s.site.latitude},${s.site.longitude}` : null;
  return (
    <>
      <p className="text-sm"><Link href={demo ? "/motorista?modo=demo" : "/motorista"} className="text-navy-500">← Estações</Link></p>
      <h1 className="mt-2 font-display text-xl font-semibold text-navy-900">{s.site.name}</h1>
      <p className="text-sm text-navy-500">{[s.site.address, s.site.city && `${s.site.city}/${s.site.state ?? ""}`].filter(Boolean).join(" · ")}</p>
      {s.site.openingHours && <p className="text-sm text-navy-500">Funcionamento: {s.site.openingHours}</p>}
      {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-700 underline">Abrir rota no mapa (site externo)</a>}
      {demo && <Alert tone="warning" className="mt-3" title="Demonstração">Estação simulada: sem cobrança e sem fornecimento real de energia.</Alert>}

      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
        <h2 className="font-display font-semibold text-navy-900">Tarifa</h2>
        {s.tariff ? (
          <p className="mt-1 text-sm">{brl(s.tariff.pricePerKwh.toString())} por kWh{Number(s.tariff.pricePerMin) > 0 ? ` + ${brl(s.tariff.pricePerMin.toString())} por minuto` : ""}. <span className="text-navy-500">Vigente desde {dateTime(s.tariff.validFrom)}.</span></p>
        ) : <p className="mt-1 text-sm text-navy-500">Sem tarifa vigente: recarga indisponível.</p>}
        <p className="mt-2 text-xs text-navy-500">{demo ? "Na demonstração nada é cobrado." : "Antes do início é feita uma reserva (pré-autorização) no meio de pagamento; ao final é cobrado só o valor apurado e o restante é liberado."}</p>
      </section>

      <section className="mt-4 flex flex-col gap-3">
        <h2 className="font-display font-semibold text-navy-900">Conectores</h2>
        {!s.fresh && <Alert tone="warning">Sem comunicação recente com a estação. A disponibilidade é desconhecida e o início pelo app fica bloqueado.</Alert>}
        {s.connectors.map((c) => {
          const can = s.fresh && ["AVAILABLE", "PREPARING"].includes(c.status) && !!s.tariff;
          return (
            <div key={c.connectorId} className="rounded-xl border border-navy-100 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">Conector {c.connectorId} · {c.type}{Number(c.maxPowerKw) > 0 ? ` · ${c.maxPowerKw} kW` : ""}</p>
                <ConnectorStatusBadge status={c.status} />
              </div>
              <p className="mt-1 text-xs text-navy-500">{c.statusReceivedAt ? `Status recebido ${dateTime(c.statusReceivedAt)}` : "Sem status recebido"}</p>
              <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-navy-600">
                <li>Estacione e conecte o cabo ao veículo.</li>
                <li>Toque em iniciar e aguarde a confirmação do carregador.</li>
                <li>Encerre pelo app ou pelo próprio veículo.</li>
              </ol>
              <div className="mt-3">
                {driver ? <StartForm identity={s.identity} connectorId={c.connectorId} label={can ? (demo ? "Iniciar recarga (demonstração)" : "Iniciar recarga") : "Indisponível"} disabled={!can} /> : <ButtonLink href={`/motorista/entrar?voltar=${encodeURIComponent(`/motorista/estacoes/${s.identity}`)}`} className="w-full" size="lg">Entrar para carregar</ButtonLink>}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
