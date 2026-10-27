import { describe, expect, it } from "vitest";
import { runViability, type ViabilityInput } from "@/domain/viability/engine";
import { REFERENCE_TERMS } from "@/domain/commercial/reference";

// Caso calculado à mão: 1 × 60 kW, 4 h/dia, 30 dias, R$ 2,40/kWh, energia R$ 1,00/kWh.
// energia = 60 × 4 × 30 = 7.200 kWh; bruto = 17.280,00
// taxa sistema 14% = 2.419,20; tributos 6% = 1.036,80; royalty 5% = 864,00; energia = 7.200,00
// fixo = 150,00 → resultado operacional = 17.280 − 11.520 − 150 = 5.610,00
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

describe("motor de viabilidade — compra integral", () => {
  const r = runViability(base());
  const m1 = r.months[0];

  it("converte potência em energia respeitando dias e horas", () => {
    expect(m1.energySoldKwh).toBe("7200.000");
    expect(r.physical.monthlyCapacityKwh).toBe("43200.000"); // 60 kW × 24 h × 30 d
  });

  it("calcula cada taxa sobre a base configurada, sem aplicar uma sobre a outra", () => {
    expect(m1.grossRevenue).toBe("17280.00");
    expect(m1.paymentFees).toBe("2419.20");
    expect(m1.revenueAfterPaymentFees).toBe("14860.80");
    expect(m1.taxes).toBe("1036.80");
    expect(m1.royalty).toBe("864.00");
    expect(m1.energyCost).toBe("7200.00");
    expect(m1.variableCosts).toBe("11520.00");
    expect(m1.fixedCosts).toBe("150.00");
    expect(m1.operatingResult).toBe("5610.00");
  });

  it("destina 100% do resultado ao investidor", () => {
    expect(m1.partnerResult).toBe("5610.00");
    expect(m1.operatorResult).toBe("0.00");
    expect(r.investment.partner).toBe("150000.00");
  });

  it("calcula payback simples com fração de mês", () => {
    // 150.000 / 5.610 = 26,74 meses
    expect(r.kpis.partnerPaybackMonths).toBe(26.7);
  });

  it("calcula retorno do 1º ano e ROI no horizonte", () => {
    expect(r.kpis.partnerFirstYearReturn).toBe("67320.00");
    expect(r.kpis.partnerFirstYearReturnRate).toBe("0.448800");
    // (5.610 × 36 − 150.000) / 150.000 = 0,3464
    expect(r.kpis.partnerRoiHorizon).toBe("0.346400");
  });

  it("calcula margem de contribuição e ponto de equilíbrio", () => {
    // 2,40 × (1 − 0,14 − 0,06 − 0,05) − 1,00 = 0,80 R$/kWh; 150 / 0,80 = 187,5 kWh
    expect(r.kpis.contributionMarginPerKwh).toBe("0.8000");
    expect(r.kpis.breakEvenKwhPerMonth).toBe("187.500");
    expect(r.kpis.breakEvenHoursPerDay).toBe("0.10");
  });

  it("totais fecham com a soma das linhas", () => {
    expect(r.totals.grossRevenue).toBe((17280 * 36).toFixed(2));
    expect(r.totals.operatingResult).toBe((5610 * 36).toFixed(2));
  });

  it("não calcula VPL sem taxa de desconto e avisa", () => {
    expect(r.kpis.npv).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/VPL não calculado/);
  });

  it("VPL com taxa zero é a soma simples dos fluxos e VPL na TIR é ~0", () => {
    const zero = runViability(base({ discountRateAnnual: 0 }));
    expect(zero.kpis.npv).toBe((5610 * 36 - 150000).toFixed(2));
    const irrAnnual = Number(zero.kpis.irrAnnual);
    const atIrr = runViability(base({ discountRateAnnual: irrAnnual }));
    expect(Math.abs(Number(atIrr.kpis.npv))).toBeLessThan(1);
  });

  it("sem payback dentro do horizonte retorna null", () => {
    expect(runViability(base({ horizonMonths: 12 })).kpis.partnerPaybackMonths).toBeNull();
  });
});

describe("motor de viabilidade — parceria 50/50", () => {
  const r = runViability(base({ terms: REFERENCE_TERMS["parceria-50-50"] }));
  const m1 = r.months[0];

  it("aplica royalty de 8% e divide resultado e investimento", () => {
    expect(m1.royalty).toBe("1382.40");
    expect(m1.operatingResult).toBe("5091.60"); // 17.280 − (2.419,20 + 1.036,80 + 1.382,40 + 7.200) − 150
    expect(m1.partnerResult).toBe("2545.80");
    expect(m1.operatorResult).toBe("2545.80");
    expect(r.investment.partner).toBe("75000.00");
    expect(r.investment.operator).toBe("75000.00");
  });

  it("divide prejuízo na mesma proporção (custos rateados)", () => {
    const loss = runViability(base({ terms: REFERENCE_TERMS["parceria-50-50"], equivalentHoursPerDay: 0 }));
    expect(loss.months[0].operatingResult).toBe("-150.00");
    expect(loss.months[0].partnerResult).toBe("-75.00");
  });
});

describe("motor de viabilidade — bases e limites físicos", () => {
  it("royalty sobre bruto após taxa de sistema usa a base reduzida", () => {
    const r = runViability(base({ terms: { ...REFERENCE_TERMS["compra-integral"], royaltyBase: "GROSS_NET_OF_PAYMENT_FEES" } }));
    expect(r.months[0].royalty).toBe("743.04"); // 14.860,80 × 5%
    expect(r.months[0].taxes).toBe("1036.80"); // tributo continua sobre o bruto
  });

  it("limita energia à capacidade física pela disponibilidade", () => {
    const r = runViability(base({ availability: 0.5, equivalentHoursPerDay: 20 }));
    expect(r.months[0].energySoldKwh).toBe("21600.000"); // 60 × 12 h × 30
    expect(r.months[0].capacityCapped).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/excedem o máximo/);
  });

  it("limita a potência simultânea ao limite de conexão", () => {
    const r = runViability(base({ chargers: [{ count: 2, powerKw: 60 }], gridLimitKw: 80 }));
    expect(r.physical.installedPowerKw).toBe("120.00");
    expect(r.physical.effectivePowerKw).toBe("80.00");
    expect(r.months[0].energySoldKwh).toBe("9600.000"); // 80 × 4 × 30
  });

  it("crescimento e sazonalidade nunca ultrapassam a capacidade", () => {
    const r = runViability(base({ equivalentHoursPerDay: 20, monthlyGrowthRate: 0.1, horizonMonths: 6 }));
    for (const m of r.months) expect(Number(m.energySoldKwh)).toBeLessThanOrEqual(43200);
  });

  it("considera perdas de eficiência no custo de energia", () => {
    const r = runViability(base({ chargingEfficiency: 0.9 }));
    expect(r.months[0].energyPurchasedKwh).toBe("8000.000");
    expect(r.months[0].energyCost).toBe("8000.00");
  });

  it("alerta margem de contribuição negativa", () => {
    const r = runViability(base({ energyCostPerKwh: 3 }));
    expect(r.kpis.breakEvenKwhPerMonth).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Margem de contribuição/);
  });

  it("gera sensibilidade coerente: mais preço → mais resultado", () => {
    const r = runViability(base());
    const price = r.sensitivity.filter((s) => s.driver === "price");
    const values = price.map((s) => Number(s.partnerAvgMonthlyResult));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    const energy = r.sensitivity.filter((s) => s.driver === "energyCost").map((s) => Number(s.partnerAvgMonthlyResult));
    expect(energy).toEqual([...energy].sort((a, b) => b - a));
  });
});

describe("validação de entrada", () => {
  it("rejeita taxa de sistema sobre base líquida (circular)", () => {
    expect(() =>
      runViability(base({ terms: { ...REFERENCE_TERMS["compra-integral"], platformFeeBase: "GROSS_NET_OF_PAYMENT_FEES" } })),
    ).toThrow();
  });
  it("rejeita potência zero, lista vazia e horas acima de 24", () => {
    expect(() => runViability(base({ chargers: [] }))).toThrow();
    expect(() => runViability(base({ chargers: [{ count: 1, powerKw: 0 }] }))).toThrow();
    expect(() => runViability(base({ equivalentHoursPerDay: 25 }))).toThrow();
  });
  it("rejeita percentuais acima de 100%", () => {
    expect(() => runViability(base({ terms: { ...REFERENCE_TERMS["compra-integral"], taxRate: 6 } }))).toThrow();
  });
});
