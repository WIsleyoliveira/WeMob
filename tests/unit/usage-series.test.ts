import { describe, expect, it } from "vitest";
import { bucketKeys, granularityFor, localDay, parseUsagePeriod, periodRange, usageSeries, usageTotals } from "@/domain/usage/series";

const at = (iso: string) => new Date(iso);
const s = (start: string, minutes: number, wh: number, paid: string | null) => ({ startedAt: at(start), stoppedAt: new Date(at(start).getTime() + minutes * 60_000), energyWh: wh, paidConfirmed: paid });

describe("séries de uso para gráficos (P23 redesign)", () => {
  it("agrupa pelo dia LOCAL de São Paulo (23h30 de 10/10 em SP é 02h30 UTC de 11/10)", () => {
    expect(localDay(at("2026-10-11T02:30:00Z"))).toBe("2026-10-10");
    const series = usageSeries([s("2026-10-11T02:30:00Z", 30, 5000, "10.00")], at("2026-10-10T03:00:00Z"), at("2026-10-11T23:00:00Z"), "day");
    expect(series.map((p) => [p.key, p.sessions])).toEqual([["2026-10-10", 1], ["2026-10-11", 0]]);
  });

  it("preenche dias sem sessão com zero e soma kWh, valor confirmado e minutos", () => {
    const from = at("2026-10-01T03:00:00Z");
    const to = at("2026-10-04T20:00:00Z");
    const series = usageSeries([s("2026-10-02T12:00:00Z", 40, 12_345, "24.69"), s("2026-10-02T18:00:00Z", 20, 1_000, null)], from, to, "day");
    expect(series.map((p) => p.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(series[1]).toMatchObject({ label: "02/10", sessions: 2, kwh: 13.345, paid: "24.69", minutes: 60 });
    expect(series[0]).toMatchObject({ sessions: 0, kwh: 0, paid: "0.00", minutes: 0 });
  });

  it("semanas começam na segunda; meses com rótulo pt-BR; granularidade pelo tamanho do período", () => {
    expect(bucketKeys(at("2026-10-07T12:00:00Z"), at("2026-10-20T12:00:00Z"), "week")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(usageSeries([], at("2026-08-10T12:00:00Z"), at("2026-10-10T12:00:00Z"), "month").map((p) => p.label)).toEqual(["ago/26", "set/26", "out/26"]);
    expect(granularityFor(at("2026-10-01T00:00:00Z"), at("2026-10-30T00:00:00Z"))).toBe("day");
    expect(granularityFor(at("2026-07-01T00:00:00Z"), at("2026-10-30T00:00:00Z"))).toBe("week");
    expect(granularityFor(at("2025-10-30T00:00:00Z"), at("2026-10-30T00:00:00Z"))).toBe("month");
  });

  it("totais: valor só o confirmado; médias só com sessões; sem sessões nada é inventado", () => {
    expect(usageTotals([])).toEqual({ sessions: 0, kwh: 0, paid: "0.00", minutes: 0, avgKwh: null, avgMinutes: null, unconfirmedPayments: 0 });
    const t = usageTotals([s("2026-10-02T12:00:00Z", 40, 12_000, "24.00"), s("2026-10-03T12:00:00Z", 20, 6_000, null)]);
    expect(t).toEqual({ sessions: 2, kwh: 18, paid: "24.00", minutes: 60, avgKwh: 9, avgMinutes: 30, unconfirmedPayments: 1 });
  });

  it("períodos do filtro: mês atual começa à meia-noite local do dia 1; inválido vira 30 dias", () => {
    const r = periodRange("mes", at("2026-10-29T15:00:00Z"));
    expect(r.from.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(parseUsagePeriod("xyz")).toBe("30");
    expect(parseUsagePeriod("90")).toBe("90");
  });
});
