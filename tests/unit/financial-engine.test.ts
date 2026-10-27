import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { irr, runViability, type ViabilityInput } from "@/domain/viability/engine";
import { REFERENCE_TERMS } from "@/domain/commercial/reference";

// Base calculada à mão (ver viability-engine.test.ts): 7.200 kWh, bruto 17.280,00, resultado operacional 5.610,00.
const base = (over: Partial<ViabilityInput> = {}): ViabilityInput => ({
  chargers: [{ count: 1, powerKw: 60 }],
  availability: 1,
  equivalentHoursPerDay: 4,
  daysPerMonth: 30,
  pricePerKwh: 2.4,
  energyCostPerKwh: 1,
  chargingEfficiency: 1,
  fixedMonthly: { connectivity: 150 },
  investment: { projectAndImplementation: 150000 },
  horizonMonths: 36,
  terms: REFERENCE_TERMS["compra-integral"],
  ...over,
});
const separateGatewayTerms = { ...REFERENCE_TERMS["compra-integral"], platformFeeRate: 0.1, platformFeeIncludesGateway: false };

describe("P05 — utilização por ocupação", () => {
  it("horas equivalentes = 24 × ocupação × fator de potência", () => {
    const { equivalentHoursPerDay: _h, ...rest } = base();
    const r = runViability({ ...rest, occupancyRate: 0.25, averagePowerFactor: 0.5 });
    expect(r.physical.utilizationMode).toBe("OCCUPANCY");
    expect(r.physical.requestedHoursPerDay).toBe("3.00");
    expect(r.months[0].energySoldKwh).toBe("5400.000"); // 60 × 3 × 30
  });

  it("exige exatamente uma forma de utilização", () => {
    expect(() => runViability(base({ occupancyRate: 0.2 }))).toThrow(/OU por ocupação/);
    const { equivalentHoursPerDay: _h, ...rest } = base();
    expect(() => runViability(rest)).toThrow(/OU por ocupação/);
  });
});

describe("P05 — taxas de sistema e gateway sem dupla contagem", () => {
  it("recusa gateway à parte quando a taxa de sistema já o inclui (14% do portfólio)", () => {
    expect(() => runViability(base({ gatewayRate: 0.02 }))).toThrow(/dupla contagem/);
    expect(() => runViability(base({ gatewayFixedPerSession: 0.5, kwhPerSession: 30 }))).toThrow(/dupla contagem/);
  });

  it("separa sistema (10%) e gateway (3% + R$ 0,50/sessão) quando contratados à parte", () => {
    const r = runViability(base({ terms: separateGatewayTerms, gatewayRate: 0.03, gatewayFixedPerSession: 0.5, kwhPerSession: 30 }));
    const m = r.months[0];
    expect(m.sessions).toBe("240.0"); // 7.200 / 30
    expect(m.paymentFees).toBe("1728.00"); // 10% × 17.280
    expect(m.gatewayFees).toBe("638.40"); // 3% × 17.280 + 240 × 0,50
    // 2,40 × (1 − 0,10 − 0,03 − 0,06 − 0,05) − 1,00 − 0,50/30
    expect(r.kpis.contributionMarginPerKwh).toBe("0.8073");
  });

  it("tarifa por transação exige kWh por sessão", () => {
    expect(() => runViability(base({ terms: separateGatewayTerms, gatewayFixedPerSession: 0.5 }))).toThrow(/kWh médio por sessão/);
  });

  it("custos variáveis = soma exata dos componentes (nenhum aplicado duas vezes)", () => {
    const r = runViability(base({ terms: separateGatewayTerms, gatewayRate: 0.03, commissionRate: 0.02, kwhPerSession: 30, gatewayFixedPerSession: 0.5 }));
    for (const m of r.months.slice(0, 3)) {
      const parts = [m.paymentFees, m.gatewayFees, m.taxes, m.royalty, m.commission, m.energyCost].reduce((a, v) => a.plus(v), new Decimal(0));
      expect(parts.toFixed(2)).toBe(m.variableCosts);
      expect(new Decimal(m.grossRevenue).minus(m.variableCosts).minus(m.fixedCosts).toFixed(2)).toBe(m.operatingResult);
    }
  });
});

describe("P05 — receita líquida, EBITDA e visão anual", () => {
  it("receita líquida = bruto − tributos; EBITDA = resultado operacional (sem depreciação)", () => {
    const r = runViability(base({ horizonMonths: 18 }));
    expect(r.months[0].netRevenue).toBe("16243.20");
    expect(r.years.map((y) => y.months)).toEqual([12, 6]);
    expect(r.years[0].grossRevenue).toBe("207360.00");
    expect(r.years[0].ebitda).toBe("67320.00");
    expect(r.years[0].operatingCosts).toBe(new Decimal("207360").minus("12441.60").minus("67320").toFixed(2)); // bruto − tributos − EBITDA
    expect(r.kpis.ebitdaHorizon).toBe((5610 * 18).toFixed(2));
  });
});

describe("P05 — capital de giro", () => {
  it("entra no aporte do mês 0 e volta no último mês", () => {
    const r = runViability(base({ workingCapital: 10000 }));
    expect(r.months[35].partnerCashFlow).toBe("15610.00");
    // (5.610 × 36 + 10.000 − 160.000) / 160.000 = 51.960 / 160.000
    expect(r.kpis.partnerRoiHorizon).toBe("0.324750");
    // após 28 meses: −160.000 + 157.080 = −2.920 → 28 + 2.920/5.610 = 28,5
    expect(r.kpis.partnerPaybackMonths).toBe(28.5);
  });

  it("no 50/50 o parceiro aporta 50% do capital de giro", () => {
    const r = runViability(base({ workingCapital: 10000, terms: REFERENCE_TERMS["parceria-50-50"] }));
    expect(r.investment.workingCapitalPartner).toBe("5000.00");
  });
});

describe("P05 — partilha 50/50 e tratamento de prejuízo", () => {
  const season = [0, ...Array(11).fill(1)];
  it("rateio mensal: parceiro aporta 50% do prejuízo no mês", () => {
    const r = runViability(base({ terms: REFERENCE_TERMS["parceria-50-50"], seasonality: season, horizonMonths: 2 }));
    expect(r.months[0].operatingResult).toBe("-150.00");
    expect(r.months[0].partnerResult).toBe("-75.00");
    expect(r.months[1].partnerResult).toBe("2545.80");
  });

  it("compensação: prejuízo é abatido antes de distribuir; total do parceiro é o mesmo, muda o momento", () => {
    const carry = { ...REFERENCE_TERMS["parceria-50-50"], lossTreatment: "CARRY_FORWARD" as const };
    const r = runViability(base({ terms: carry, seasonality: season, horizonMonths: 2 }));
    expect(r.months[0].partnerResult).toBe("0.00");
    expect(r.months[0].lossCarriedForward).toBe("-150.00");
    expect(r.months[1].distributableResult).toBe("4941.60"); // 5.091,60 − 150
    expect(r.months[1].partnerResult).toBe("2470.80");
    expect(r.totals.partnerResult).toBe("2470.80"); // = −75 + 2.545,80 no rateio mensal
    expect(r.warnings.join(" ")).toMatch(/supera o capital de giro/);
  });
});

describe("P05 — limiares de viabilidade e sinalizações", () => {
  const r = runViability(base());
  it("calcula limiares em que o resultado do mês 1 zera", () => {
    // preço mín = (150/7.200 + 1,00) / 0,75 ; energia máx = 2,40 × 0,75 − 150/7.200 ; fixo máx = 7.200 × 0,80
    expect(r.viabilityThresholds.minPricePerKwh).toBe("1.3611");
    expect(r.viabilityThresholds.maxEnergyCostPerKwh).toBe("1.7792");
    expect(r.viabilityThresholds.maxFixedMonthly).toBe("5760.00");
    expect(r.viabilityThresholds.minHoursPerDay).toBe("0.10");
  });

  it("limiares conferem com o motor (resultado ≈ 0 no limiar)", () => {
    const atPrice = runViability(base({ pricePerKwh: Number(r.viabilityThresholds.minPricePerKwh) }), { sensitivity: false });
    expect(Math.abs(Number(atPrice.months[0].operatingResult))).toBeLessThan(1.5);
    const atEnergy = runViability(base({ energyCostPerKwh: Number(r.viabilityThresholds.maxEnergyCostPerKwh) }), { sensitivity: false });
    expect(Math.abs(Number(atEnergy.months[0].operatingResult))).toBeLessThan(1.5);
    const atFixed = runViability(base({ fixedMonthly: { connectivity: Number(r.viabilityThresholds.maxFixedMonthly) } }), { sensitivity: false });
    expect(Math.abs(Number(atFixed.months[0].operatingResult))).toBeLessThan(1.5);
  });

  it("sinaliza inviabilidade e ordena variáveis por impacto", () => {
    expect(runViability(base({ horizonMonths: 12 })).viabilityFlags.join(" ")).toMatch(/não se paga em 12 meses/);
    expect(runViability(base({ energyCostPerKwh: 3 })).viabilityFlags.join(" ")).toMatch(/inviável em qualquer volume/);
    const spreads = r.sensitivityRanking.map((s) => Number(s.spread));
    expect(r.sensitivityRanking).toHaveLength(4);
    expect(spreads).toEqual([...spreads].sort((a, b) => b - a));
    expect(r.sensitivityRanking[0].driver).toBe("price");
  });
});

describe("P05 — TIR, arredondamento e extremos", () => {
  it("TIR de fluxos conhecidos", () => {
    expect(irr([-100, 110])!.toDecimalPlaces(6).toNumber()).toBe(0.1);
    expect(irr([-100, 60, 60])!.toDecimalPlaces(5).toNumber()).toBe(0.13066);
    expect(irr([-100, -10])).toBeNull();
  });

  it("arredonda meio centavo para cima (ROUND_HALF_UP), não para o par", () => {
    const r = runViability(base({ chargers: [{ count: 1, powerKw: 1 }], equivalentHoursPerDay: 1, daysPerMonth: 1, pricePerKwh: 2.345, fixedMonthly: {}, horizonMonths: 1 }));
    expect(r.months[0].grossRevenue).toBe("2.35");
  });

  it("24 h com disponibilidade 100% não excede a capacidade; preço zero é recusado", () => {
    const r = runViability(base({ equivalentHoursPerDay: 24 }));
    expect(r.months[0].energySoldKwh).toBe(r.physical.monthlyCapacityKwh);
    expect(() => runViability(base({ pricePerKwh: 0 }))).toThrow();
  });

  it("campos opcionais ausentes não geram NaN", () => {
    const r = runViability(base());
    expect(r.months[0].sessions).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it("sem investimento: payback 0 e ROI indefinido (sem divisão por zero)", () => {
    const r = runViability(base({ investment: {} }));
    expect(r.kpis.partnerPaybackMonths).toBe(0);
    expect(r.kpis.partnerRoiHorizon).toBeNull();
  });
});

describe("P05 — compatibilidade com simulações do motor 1.0", () => {
  it("premissas antigas recebem padrões equivalentes à semântica anterior e produzem o mesmo resultado", async () => {
    const { normalizeStoredInput } = await import("@/domain/viability/engine");
    const { platformFeeIncludesGateway: _g, lossTreatment: _l, ...oldTerms } = REFERENCE_TERMS["compra-integral"];
    const legacy = { ...base(), terms: oldTerms, versionStatusAtRun: "APPROVED" };
    const n = normalizeStoredInput(legacy)!;
    expect(n.terms.platformFeeIncludesGateway).toBe(true);
    expect(n.terms.lossTreatment).toBe("SHARE_MONTHLY");
    expect(n.workingCapital).toBe(0);
    expect(runViability(n).months[0].partnerResult).toBe("5610.00"); // mesmo valor do motor 1.0
  });
});
