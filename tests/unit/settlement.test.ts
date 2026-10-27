import { describe, expect, it } from "vitest";
import { byPartner, canonicalJson, computeSiteLine, totals, type ContractTerms, type SiteInput } from "@/domain/finance/settlement";
import { coversWholePeriod, periodOf, periodRange, previousPeriod } from "@/domain/finance/period";
import { versionChangesWithin, versionEffectiveAt } from "@/domain/finance/contracts";

const terms = (o: Partial<ContractTerms> = {}): ContractTerms => ({
  contractId: "c1", contractNumber: "CTR-1", versionId: "v1", version: 1,
  royaltyRate: "0.05", royaltyBase: "GROSS_REVENUE", platformFeeRate: "0.14",
  partnerShareRate: "1", partnerShareBase: "OPERATING_RESULT", lossTreatment: "SHARE_MONTHLY", paymentTermDays: 10, ...o,
});
const site = (o: Partial<SiteInput> = {}): SiteInput => ({
  siteId: "s1", siteName: "Posto", partnerOrganizationId: "p1", partnerName: "Parceiro", contract: terms(),
  stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "10000", paymentCount: 3 }], manualRevenue: [], expenses: [], lossCarriedIn: "0", ...o,
});
const TAX6 = [{ name: "Simples", rate: "0.06" }];

describe("apuração de royalties e repasses", () => {
  it("compra integral: bruto, tributos, taxa de sistema, royalty sobre bruto, repasse de 100% do resultado", () => {
    const l = computeSiteLine(site({ expenses: [{ category: "ENERGY", amount: "3000" }, { category: "RENT", amount: "150" }] }), TAX6);
    expect(l).toMatchObject({ gross: "10000.00", taxTotal: "600.00", platformFee: "1400.00", netRevenue: "8000.00", royalty: "500.00", expenses: "3150.00", operatingResult: "4350.00", partnerShare: "4350.00", operatorResult: "0.00" });
    expect(l.expensesByCategory).toEqual({ ENERGY: "3000.00", RENT: "150.00" });
  });

  it("50/50 com prejuízo rateado: repasse negativo = aporte do parceiro", () => {
    const c = terms({ royaltyRate: "0.08", royaltyBase: "NET_REVENUE", platformFeeRate: "0.10", partnerShareRate: "0.5" });
    const l = computeSiteLine(site({ contract: c, stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "1000", paymentCount: 1 }], expenses: [{ category: "ENERGY", amount: "1000" }] }), TAX6);
    // 1000 − 60 − 100 = 840; royalty 8% × 840 = 67,20; resultado 840 − 1000 − 67,20 = −227,20; 50% = −113,60
    expect(l).toMatchObject({ netRevenue: "840.00", royalty: "67.20", operatingResult: "-227.20", partnerShare: "-113.60", lossCarriedOut: "0.00", operatorResult: "-113.60" });
  });

  it("50/50 com compensação: prejuízo vai ao mês seguinte e é abatido antes do repasse", () => {
    const c = terms({ royaltyRate: "0.08", royaltyBase: "NET_REVENUE", platformFeeRate: "0.10", partnerShareRate: "0.5", lossTreatment: "CARRY_FORWARD" });
    const m1 = computeSiteLine(site({ contract: c, stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "1000", paymentCount: 1 }], expenses: [{ category: "ENERGY", amount: "1000" }] }), TAX6);
    expect(m1).toMatchObject({ operatingResult: "-227.20", partnerShare: "0.00", lossCarriedOut: "227.20", operatorResult: "-227.20" });
    // mês 2: 2000 bruto → 120 + 200 → 1680 líquida; royalty 134,40; custos 1045,60 → resultado 500,00; base 500 − 227,20 = 272,80 → 136,40
    const m2 = computeSiteLine(site({ contract: c, stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "2000", paymentCount: 1 }], expenses: [{ category: "ENERGY", amount: "1045.60" }], lossCarriedIn: m1.lossCarriedOut }), TAX6);
    expect(m2).toMatchObject({ operatingResult: "500.00", lossCarriedIn: "227.20", partnerShareBaseValue: "272.80", partnerShare: "136.40", lossCarriedOut: "0.00" });
  });

  it("arredonda cada linha (ROUND_HALF_UP) e soma linhas arredondadas", () => {
    const c = terms({ platformFeeRate: "0.145", royaltyRate: "0.05", partnerShareRate: "0.5" });
    const l = computeSiteLine(site({ contract: c, stations: [{ stationId: "a", identity: "A", chargingRevenue: "10.01", paymentCount: 1 }] }), [{ name: "T", rate: "0.0925" }]);
    // tributo 10,01 × 0,0925 = 0,925925 → 0,93; taxa 1,45145 → 1,45; líquida 7,63; royalty 0,5005 → 0,50; resultado 7,13; 50% = 3,565 → 3,57
    expect(l).toMatchObject({ taxTotal: "0.93", platformFee: "1.45", netRevenue: "7.63", royalty: "0.50", operatingResult: "7.13", partnerShare: "3.57", operatorResult: "3.56" });
  });

  it("receita de recarga lançada externamente compõe a receita de recarga, não 'outras receitas'", () => {
    const l = computeSiteLine(site({ stations: [{ stationId: "a", identity: "A", chargingRevenue: "100", paymentCount: 1 }], manualRevenue: [{ category: "CHARGING_REVENUE", amount: "1000" }, { category: "OTHER_REVENUE", amount: "50" }] }), []);
    expect(l).toMatchObject({ chargingRevenue: "1100.00", otherRevenue: "50.00", gross: "1150.00" });
  });

  it("unidade própria (sem contrato): sem taxa de sistema, royalty nem repasse", () => {
    const l = computeSiteLine(site({ partnerOrganizationId: null, partnerName: null, contract: null, expenses: [{ category: "ENERGY", amount: "100" }] }), TAX6);
    expect(l).toMatchObject({ platformFee: "0.00", royalty: "0.00", partnerShare: "0.00", operatingResult: "9300.00", operatorResult: "9300.00" });
  });

  it("totais da rede e por parceiro; despesas sem unidade só no resultado da rede", () => {
    const a = computeSiteLine(site(), TAX6);
    const b = computeSiteLine(site({ siteId: "s2", partnerOrganizationId: "p2", partnerName: "Outro" }), TAX6);
    const t = totals([a, b], "100.50");
    expect(t.gross).toBe("20000.00");
    expect(t).toMatchObject({ operatorResult: "0.00", networkExpenses: "100.50", networkResult: "-100.50" });
    expect(byPartner([a, b]).map((p) => p.partnerOrganizationId)).toEqual(["p1", "p2"]);
  });

  it("hash canônico independe da ordem das chaves e ignora campos indefinidos", () => {
    expect(canonicalJson({ b: 1, a: { d: "x", c: null }, z: undefined })).toBe(canonicalJson({ a: { c: null, d: "x" }, b: 1 }));
  });
});

describe("períodos e vigência", () => {
  it("período em America/Belem (UTC−3)", () => {
    expect(periodRange("2026-12")).toEqual({ start: new Date("2026-12-01T03:00:00Z"), end: new Date("2027-01-01T03:00:00Z") });
    expect(periodOf(new Date("2026-11-01T02:59:00Z"))).toBe("2026-10");
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(coversWholePeriod({ from: new Date("2026-10-15T00:00:00-03:00"), to: null }, "2026-10")).toBe(false);
  });

  it("versão vigente = aprovada com maior início ≤ data; troca no meio do mês é detectada", () => {
    const vs = [
      { id: "1", version: 1, status: "APPROVED", effectiveFrom: new Date("2026-01-01T03:00:00Z"), effectiveTo: null },
      { id: "2", version: 2, status: "APPROVED", effectiveFrom: new Date("2026-10-15T03:00:00Z"), effectiveTo: null },
      { id: "3", version: 3, status: "DRAFT", effectiveFrom: new Date("2026-09-01T03:00:00Z"), effectiveTo: null },
    ];
    expect(versionEffectiveAt(vs, new Date("2026-10-01T03:00:00Z"))?.id).toBe("1");
    expect(versionEffectiveAt(vs, new Date("2026-10-20T03:00:00Z"))?.id).toBe("2");
    expect(versionChangesWithin(vs, ...Object.values(periodRange("2026-10")) as [Date, Date]).map((v) => v.id)).toEqual(["2"]);
    expect(versionChangesWithin(vs, ...Object.values(periodRange("2026-09")) as [Date, Date])).toEqual([]);
  });
});
