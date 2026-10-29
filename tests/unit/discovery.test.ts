import { describe, expect, it } from "vitest";
import { compatibleVehicles, distanceKm, formatDistance, hasActiveFilters, matchesFilters, parseDiscoveryFilters, sortByDistance } from "@/domain/stations/discovery";

const ccsFast = { fresh: true, tariff: { pricePerKwh: "2.00" }, connectors: [{ type: "CCS2" as const, maxPowerKw: "60.00", status: "AVAILABLE" }] };
const type2 = { fresh: true, tariff: { pricePerKwh: "1.50" }, connectors: [{ type: "TYPE2" as const, maxPowerKw: "22.00", status: "AVAILABLE" }] };
const stale = { fresh: false, tariff: { pricePerKwh: "2.50" }, connectors: [{ type: "CCS2" as const, maxPowerKw: "150.00", status: "UNKNOWN" }] };
const noTariff = { fresh: true, tariff: null, connectors: [{ type: "CCS2" as const, maxPowerKw: "60.00", status: "AVAILABLE" }] };
const mixed = {
  fresh: true,
  tariff: { pricePerKwh: "2.00" },
  connectors: [
    { type: "CCS2" as const, maxPowerKw: "120.00", status: "CHARGING" },
    { type: "TYPE2" as const, maxPowerKw: "22.00", status: "AVAILABLE" },
  ],
};
const none = parseDiscoveryFilters({});

describe("descoberta de estações (P23 B2)", () => {
  it("lê filtros da URL e ignora valores inválidos sem quebrar a lista", () => {
    expect(parseDiscoveryFilters({ conector: "TYPE2", potencia: "50", preco: "1,8", disponivel: "1", compativel: "on" })).toEqual({ conector: "TYPE2", potencia: 50, preco: 1.8, disponivel: true, compativel: true });
    expect(parseDiscoveryFilters({ conector: "XPTO", potencia: "-3", preco: "abc", disponivel: "talvez" })).toEqual({ conector: undefined, potencia: undefined, preco: undefined, disponivel: false, compativel: false });
    expect(parseDiscoveryFilters({ conector: ["CCS2", "TYPE2"] }).conector).toBe("CCS2");
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters(parseDiscoveryFilters({ potencia: "22" }))).toBe(true);
  });

  it("conector, potência mínima e preço máximo; sem tarifa sai quando há filtro de preço", () => {
    const f = (raw: Record<string, string>) => parseDiscoveryFilters(raw);
    expect([ccsFast, type2, stale].filter((s) => matchesFilters(s, f({ conector: "TYPE2" }), []))).toEqual([type2]);
    expect([ccsFast, type2, stale].filter((s) => matchesFilters(s, f({ potencia: "50" }), []))).toEqual([ccsFast, stale]);
    expect([ccsFast, type2, noTariff].filter((s) => matchesFilters(s, f({ preco: "2" }), []))).toEqual([ccsFast, type2]); // ≤ R$ 2,00 inclusive
    expect(matchesFilters(noTariff, none, [])).toBe(true);
  });

  it("'disponível agora' exige comunicação recente E status AVAILABLE; sem comunicação nunca conta", () => {
    const f = parseDiscoveryFilters({ disponivel: "1" });
    expect(matchesFilters(ccsFast, f, [])).toBe(true);
    expect(matchesFilters(stale, f, [])).toBe(false);
    expect(matchesFilters({ ...ccsFast, fresh: false, connectors: [{ ...ccsFast.connectors[0], status: "AVAILABLE" }] }, f, [])).toBe(false);
  });

  it("os critérios valem para o MESMO conector (CCS2 120 kW ocupado + Tipo 2 livre não é 'CCS2 disponível')", () => {
    expect(matchesFilters(mixed, parseDiscoveryFilters({ conector: "CCS2", disponivel: "1" }), [])).toBe(false);
    expect(matchesFilters(mixed, parseDiscoveryFilters({ conector: "TYPE2", disponivel: "1" }), [])).toBe(true);
    expect(matchesFilters(mixed, parseDiscoveryFilters({ potencia: "100", disponivel: "1" }), [])).toBe(false);
  });

  it("compatibilidade só pelo tipo de conector dos veículos cadastrados", () => {
    const vehicles = [{ label: "Carro Tipo 2", connectorTypes: ["TYPE2" as const] }];
    expect(compatibleVehicles({ type: "TYPE2" }, vehicles).map((v) => v.label)).toEqual(["Carro Tipo 2"]);
    expect(compatibleVehicles({ type: "CCS2" }, vehicles)).toEqual([]);
    const f = parseDiscoveryFilters({ compativel: "1" });
    expect([ccsFast, type2, mixed].filter((s) => matchesFilters(s, f, vehicles))).toEqual([type2, mixed]);
    expect(matchesFilters(type2, f, [])).toBe(false); // sem veículo cadastrado não há compatibilidade conhecida
  });

  it("distância em linha reta e ordenação; sem coordenadas vai para o fim", () => {
    const sp = { lat: -23.5505, lon: -46.6333 };
    const rj = { lat: -22.9068, lon: -43.1729 };
    expect(distanceKm(sp, rj)).toBeGreaterThan(355);
    expect(distanceKm(sp, rj)).toBeLessThan(365);
    expect(distanceKm(sp, sp)).toBe(0);
    const sorted = sortByDistance([{ id: "sp", ...sp }, { id: "sem", lat: null, lon: null }, { id: "rj", ...rj }], { lat: -22.95, lon: -43.2 });
    expect(sorted.map((s) => s.id)).toEqual(["rj", "sp", "sem"]);
    expect(sorted[2].km).toBeNull();
    expect(formatDistance(0.33)).toBe("≈ 350 m");
    expect(formatDistance(0.01)).toBe("≈ 50 m");
    expect(formatDistance(3.24)).toBe("≈ 3,2 km");
    expect(formatDistance(358.6)).toBe("≈ 359 km");
  });
});
