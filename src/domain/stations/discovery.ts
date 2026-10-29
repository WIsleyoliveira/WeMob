import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Descoberta de estações pelo motorista (regra pura, P23 B2). Filtra só pelo que o sistema sabe de forma
 * confiável: tipo e potência NOMINAL do conector, status efetivo (sem comunicação → desconhecido, nunca
 * "disponível"), tarifa vigente e conectores dos veículos cadastrados. Compatibilidade é só pelo tipo de
 * conector — marca/modelo e potência aceita pelo veículo não são verificados.
 */

export const CONNECTOR_TYPES = ["CCS2", "TYPE2", "CHADEMO", "GBT", "OTHER"] as const;
export type ConnectorTypeCode = (typeof CONNECTOR_TYPES)[number];
export const CONNECTOR_LABEL: Record<ConnectorTypeCode, string> = { CCS2: "CCS2", TYPE2: "Tipo 2", CHADEMO: "CHAdeMO", GBT: "GB/T", OTHER: "Outro" };

const flag = z.preprocess((v) => v === "1" || v === "on" || v === true, z.boolean());
const optionalNumber = (max: number) => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : String(v).replace(",", ".")), z.coerce.number().positive().max(max).optional());

/** Filtros vindos da URL. Valores inválidos são ignorados (a lista nunca quebra por um parâmetro ruim). */
export const discoveryFilterSchema = z.object({
  conector: z.enum(CONNECTOR_TYPES).optional().catch(undefined),
  potencia: optionalNumber(1000).catch(undefined),
  preco: optionalNumber(100).catch(undefined),
  disponivel: flag.catch(false),
  compativel: flag.catch(false),
});
export type DiscoveryFilters = z.infer<typeof discoveryFilterSchema>;

export function parseDiscoveryFilters(raw: Record<string, string | string[] | undefined>): DiscoveryFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]);
  return discoveryFilterSchema.parse({ conector: one("conector"), potencia: one("potencia"), preco: one("preco"), disponivel: one("disponivel"), compativel: one("compativel") });
}

export const hasActiveFilters = (f: DiscoveryFilters) => !!(f.conector || f.potencia || f.preco || f.disponivel || f.compativel);

type Connector = { type: ConnectorTypeCode; maxPowerKw: string; status: string };
type Station = { fresh: boolean; tariff: { pricePerKwh: Decimal.Value } | null; connectors: Connector[] };
type Vehicle = { label: string; connectorTypes: ConnectorTypeCode[] };

/** Veículos cadastrados cujo conector é do mesmo tipo. Lista vazia = sem compatibilidade conhecida. */
export function compatibleVehicles(connector: { type: ConnectorTypeCode }, vehicles: Vehicle[]) {
  return vehicles.filter((v) => v.connectorTypes.includes(connector.type));
}

/** Disponível só com comunicação recente E status efetivo AVAILABLE (dado confiável). */
export const isAvailableNow = (station: { fresh: boolean }, c: { status: string }) => station.fresh && c.status === "AVAILABLE";

/** A estação atende aos filtros se UM mesmo conector satisfaz todos os critérios por conector. */
export function matchesFilters(station: Station, f: DiscoveryFilters, vehicles: Vehicle[]) {
  if (f.preco !== undefined && (!station.tariff || new Decimal(station.tariff.pricePerKwh).gt(f.preco))) return false;
  const vehicleTypes = new Set(vehicles.flatMap((v) => v.connectorTypes));
  return station.connectors.some(
    (c) =>
      (!f.conector || c.type === f.conector) &&
      (f.potencia === undefined || new Decimal(c.maxPowerKw).gte(f.potencia)) &&
      (!f.disponivel || isAvailableNow(station, c)) &&
      (!f.compativel || vehicleTypes.has(c.type)),
  );
}

/** Distância em linha reta (haversine, km). Não é distância de rota nem tempo de viagem. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ordena por distância; estações sem coordenadas vão para o fim, na ordem original. */
export function sortByDistance<T extends { lat: number | null; lon: number | null }>(items: T[], origin: { lat: number; lon: number }) {
  return items
    .map((item, i) => ({ item, i, km: item.lat !== null && item.lon !== null ? distanceKm(origin, { lat: item.lat, lon: item.lon }) : null }))
    .sort((x, y) => (x.km === null ? (y.km === null ? x.i - y.i : 1) : y.km === null ? -1 : x.km - y.km || x.i - y.i))
    .map(({ item, km }) => ({ ...item, km }));
}

/** "≈ 1,2 km" / "≈ 350 m" (linha reta, arredondado — nunca uma promessa de rota). */
export function formatDistance(km: number) {
  if (km < 1) return `≈ ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `≈ ${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`;
}
