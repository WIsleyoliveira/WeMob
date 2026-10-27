import Link from "next/link";
import { getDriver } from "@/server/drivers/current";
import { getActiveRequest, listDriverStations } from "@/server/drivers/service";
import { Alert } from "@/components/ui/alert";
import { StateMessage } from "@/components/ui/state";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl, dateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function DriverHome({ searchParams }: { searchParams: Promise<{ modo?: string }> }) {
  const mode = (await searchParams).modo === "demo" ? "demo" : "real";
  const driver = await getDriver();
  const [stations, active] = await Promise.all([listDriverStations(mode), driver ? getActiveRequest(driver) : null]);
  return (
    <>
      {active && (
        <Link href={active.sessionId ? `/motorista/recarga/${active.sessionId}` : `/motorista/pedido/${active.id}`} className="mb-4 block rounded-xl bg-brand-600 p-4 text-white shadow">
          <p className="text-sm opacity-90">{active.sessionId ? "Recarga em andamento" : "Pedido de recarga em processamento"}</p>
          <p className="font-display text-lg font-semibold">Acompanhar →</p>
        </Link>
      )}
      <h1 className="font-display text-xl font-semibold text-navy-900">Estações</h1>
      <div className="mt-3 grid grid-cols-2 rounded-lg border border-navy-200 bg-white p-0.5 text-sm" role="tablist">
        {([["real", "Rede"], ["demo", "Demonstração"]] as const).map(([k, l]) => (
          <Link key={k} href={k === "real" ? "/motorista" : "/motorista?modo=demo"} role="tab" aria-selected={mode === k} className={cn("rounded-md py-2 text-center", mode === k ? "bg-navy-900 font-medium text-white" : "text-navy-600")}>{l}</Link>
        ))}
      </div>
      {mode === "demo" && <Alert tone="warning" className="mt-3" title="Ambiente de demonstração">Estações simuladas. Nenhum pagamento é cobrado e as recargas não são reais.</Alert>}
      <div className="mt-4 flex flex-col gap-3">
        {stations.length === 0 ? (
          <StateMessage
            kind={mode === "real" ? "unavailable" : "empty"}
            title={mode === "real" ? "Nenhuma estação pública integrada ainda" : "Nenhuma estação de demonstração"}
            description={mode === "real" ? <>Assim que os eletropostos da rede estiverem conectados, eles aparecem aqui. <Link className="underline" href="/motorista?modo=demo">Ver demonstração</Link>.</> : undefined}
          />
        ) : (
          stations.map((s) => (
            <Link key={s.id} href={`/motorista/estacoes/${encodeURIComponent(s.identity)}`} className="rounded-xl border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display font-semibold text-navy-900">{s.site.name}</p>
                  <p className="truncate text-sm text-navy-500">{[s.site.address, s.site.city && `${s.site.city}/${s.site.state ?? ""}`].filter(Boolean).join(" · ") || s.identity}</p>
                </div>
                <p className="shrink-0 text-right text-sm font-semibold text-navy-900">{s.tariff ? `${brl(s.tariff.pricePerKwh.toString())}/kWh` : "sem tarifa"}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.connectors.map((c) => <span key={c.connectorId} className="inline-flex items-center gap-1 text-xs text-navy-600">{c.type} {Number(c.maxPowerKw) > 0 ? `${c.maxPowerKw} kW` : ""} <ConnectorStatusBadge status={c.status} /></span>)}
              </div>
              <p className="mt-2 text-xs text-navy-500">{s.fresh ? `Atualizado ${s.lastSeenAt ? dateTime(s.lastSeenAt) : ""}` : "Sem comunicação recente: disponibilidade desconhecida"}</p>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
