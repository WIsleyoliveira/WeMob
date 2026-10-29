import Link from "next/link";
import { getDriver } from "@/server/drivers/current";
import { getActiveRequest, listDriverStations, listMyVehicles } from "@/server/drivers/service";
import { Alert } from "@/components/ui/alert";
import { StateMessage } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ConnectorStatusBadge } from "@/components/app/station-badges";
import { brl, dateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CONNECTOR_LABEL, CONNECTOR_TYPES, compatibleVehicles, hasActiveFilters, matchesFilters, parseDiscoveryFilters } from "@/domain/stations/discovery";
import { NearbyList } from "./nearby-list";

export const dynamic = "force-dynamic";

export default async function DriverHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const mode = params.modo === "demo" ? "demo" : "real";
  const filters = parseDiscoveryFilters(params);
  const driver = await getDriver();
  const [stations, active, vehicles] = await Promise.all([listDriverStations(mode), driver ? getActiveRequest(driver) : null, listMyVehicles(driver)]);
  const shown = stations.filter((s) => matchesFilters(s, filters, vehicles));
  const filtered = hasActiveFilters(filters);
  const base = mode === "demo" ? "/motorista?modo=demo" : "/motorista";
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

      {stations.length > 0 && (
        <details className="mt-3 rounded-xl border border-navy-100 bg-white p-3" open={filtered}>
          <summary className="cursor-pointer text-sm font-medium text-navy-900">Filtros{filtered ? " (ativos)" : ""}</summary>
          {/* GET: os filtros ficam no endereço (sem dado pessoal) e funcionam sem JavaScript. */}
          <form method="get" action="/motorista" className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {mode === "demo" && <input type="hidden" name="modo" value="demo" />}
            <label className="flex flex-col gap-1">
              <span className="font-medium text-navy-800">Conector</span>
              <Select name="conector" defaultValue={filters.conector ?? ""} className="h-10">
                <option value="">Qualquer</option>
                {CONNECTOR_TYPES.map((t) => <option key={t} value={t}>{CONNECTOR_LABEL[t]}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-navy-800">Potência mínima (kW)</span>
              <Input name="potencia" type="number" inputMode="decimal" min={1} max={1000} step="any" defaultValue={filters.potencia ?? ""} className="h-10" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-navy-800">Preço máximo (R$/kWh)</span>
              <Input name="preco" type="number" inputMode="decimal" min={0.01} max={100} step="0.01" defaultValue={filters.preco ?? ""} className="h-10" />
            </label>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="disponivel" value="1" defaultChecked={filters.disponivel} className="size-4 accent-brand-600" />Disponível agora</label>
              {vehicles.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" name="compativel" value="1" defaultChecked={filters.compativel} className="size-4 accent-brand-600" />Compatível com meu veículo</label>}
            </div>
            <p className="col-span-2 text-xs text-navy-500">
              “Disponível agora” considera só conectores livres com comunicação recente. Potência é a nominal do conector; a real depende do veículo.
              {vehicles.length === 0 && driver && <> <Link href="/motorista/conta" className="underline">Cadastre seu veículo</Link> para filtrar por compatibilidade.</>}
            </p>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" size="sm">Aplicar filtros</Button>
              {filtered && <Link href={base} className="inline-flex h-8 items-center px-2 text-sm font-medium text-navy-600 underline">Limpar filtros</Link>}
            </div>
          </form>
        </details>
      )}

      {stations.length === 0 ? (
        <StateMessage
          className="mt-4"
          kind={mode === "real" ? "unavailable" : "empty"}
          title={mode === "real" ? "Nenhuma estação pública integrada ainda" : "Nenhuma estação de demonstração"}
          description={mode === "real" ? <>Assim que os eletropostos da rede estiverem conectados, eles aparecem aqui. <Link className="underline" href="/motorista?modo=demo">Ver demonstração</Link>.</> : undefined}
        />
      ) : shown.length === 0 ? (
        <StateMessage className="mt-4" kind="empty" title="Nenhuma estação com esses filtros" description={<Link className="underline" href={base}>Limpar filtros</Link>} />
      ) : (
        <>
          {filtered && <p className="mt-3 text-sm text-navy-600" role="status">{shown.length === 1 ? "1 estação encontrada" : `${shown.length} estações encontradas`}</p>}
          <NearbyList
            items={shown.map((s) => ({
              id: s.id,
              lat: s.site.latitude !== null ? Number(s.site.latitude) : null,
              lon: s.site.longitude !== null ? Number(s.site.longitude) : null,
              card: (
                <Link href={`/motorista/estacoes/${encodeURIComponent(s.identity)}`} className="block rounded-xl border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold text-navy-900">{s.site.name}</p>
                      <p className="truncate text-sm text-navy-500">{[s.site.address, s.site.city && `${s.site.city}/${s.site.state ?? ""}`].filter(Boolean).join(" · ") || s.identity}</p>
                    </div>
                    <p className="shrink-0 text-right text-sm font-semibold text-navy-900">{s.tariff ? `${brl(s.tariff.pricePerKwh.toString())}/kWh` : "sem tarifa"}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.connectors.map((c) => <span key={c.connectorId} className="inline-flex items-center gap-1 text-xs text-navy-600">{CONNECTOR_LABEL[c.type]} {Number(c.maxPowerKw) > 0 ? `${c.maxPowerKw} kW` : ""} <ConnectorStatusBadge status={c.status} /></span>)}
                  </div>
                  {vehicles.length > 0 && (
                    <p className="mt-2 text-xs text-navy-600">
                      {s.connectors.some((c) => compatibleVehicles(c, vehicles).length > 0) ? "Conector compatível com seu veículo" : "Sem conector compatível com seus veículos cadastrados"}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-navy-500">{s.fresh ? `Atualizado ${s.lastSeenAt ? dateTime(s.lastSeenAt) : ""}` : "Sem comunicação recente: disponibilidade desconhecida"}</p>
                </Link>
              ),
            }))}
          />
        </>
      )}
    </>
  );
}
