import { describe, expect, it } from "vitest";
import { budgetCheck, computePlatformCosts, costScenarios, fxSensitivity } from "@/domain/costs/platform";
import { REFERENCE_COST_ASSUMPTIONS as A, REFERENCE_COST_ITEMS as ITEMS, REFERENCE_SCENARIOS } from "@/domain/costs/reference";

describe("custos operacionais da plataforma (planilha WeMob_Custos_Mensais_Detalhados.xlsx)", () => {
  it("reproduz a aba 'Custos mensais': base 1.000,00 · câmbio 1.220,20 · reserva 732,12 · prudencial 1.952,32", () => {
    const r = computePlatformCosts(ITEMS, A, 0);
    expect(r.totals).toEqual({ base: "1000.00", dollarExposed: "550.50", withFx: "1220.20", reserve: "732.12", prudential: "1952.32" });
    expect(r.lines.find((l) => l.key === "app-api")).toMatchObject({ base: "240.00", withFx: "336.00", reserve: "201.60", prudential: "537.60" });
    expect(r.lines.find((l) => l.key === "maps")).toMatchObject({ withFx: "60.00", reserve: "36.00", prudential: "96.00" });
    expect(r.lines.find((l) => l.key === "support")).toMatchObject({ withFx: "407.00", prudential: "651.20" }); // sem exposição cambial
  });

  it("'TOTAL PRUDENCIAL COM 1 POSTO' = 2.352,32 (R$ 250 + R$ 150 por posto)", () => {
    const r = computePlatformCosts(ITEMS, A, 1);
    expect(r).toMatchObject({ perStationUnit: "400.00", fixedMonthly: "1952.32", variableMonthly: "400.00", totalMonthly: "2352.32" });
  });

  it("reproduz a aba 'Cenarios de custo'", () => {
    expect(costScenarios(ITEMS, A, REFERENCE_SCENARIOS).map((s) => [s.name, s.stations, s.totalMonthly])).toEqual([
      ["Piloto", 1, "2352.32"],
      ["Rede pequena", 3, "3152.32"],
      ["Rede em crescimento", 5, "3952.32"],
      ["Rede média", 10, "5952.32"],
      ["Rede maior", 20, "9952.32"],
    ]);
  });

  it("custo por categoria soma o total; exposição ao dólar separada", () => {
    const r = computePlatformCosts(ITEMS, A, 0);
    expect(r.byCategory).toEqual([
      { category: "INFRASTRUCTURE", prudential: "1137.92" },
      { category: "SERVICES", prudential: "163.20" },
      { category: "OPERATIONS", prudential: "651.20" },
    ]);
  });

  it("sensibilidade ao câmbio: sem alta, +20%, +40% (planilha), +60%", () => {
    expect(fxSensitivity(ITEMS, A, [0, 0.2, 0.4, 0.6]).map((x) => x.prudential)).toEqual(["1600.00", "1776.16", "1952.32", "2128.48"]);
  });

  it("orçado × realizado com tolerância", () => {
    expect(budgetCheck("2352.32", null, 0.1)).toEqual({ state: "NO_ACTUAL", variance: null, variancePct: null });
    expect(budgetCheck("2352.32", "2500", 0.1)).toMatchObject({ state: "WITHIN", variance: "147.68" });
    expect(budgetCheck("2352.32", "2600", 0.1)).toMatchObject({ state: "OVER", variance: "247.68" });
    expect(budgetCheck("1000", "900", 0)).toMatchObject({ state: "WITHIN", variance: "-100.00", variancePct: "-0.1" });
  });

  it("recusa número de postos inválido", () => {
    expect(() => computePlatformCosts(ITEMS, A, -1)).toThrow();
    expect(() => computePlatformCosts(ITEMS, A, 1.5)).toThrow();
  });
});
