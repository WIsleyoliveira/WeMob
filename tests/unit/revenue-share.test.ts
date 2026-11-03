import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { SETTLEMENT_ENGINE_VERSION, computeSiteLine, splitGross, totals, type ContractTerms, type SiteInput } from "@/domain/finance/settlement";

/** Regra comercial oficial (WAPE, 2026-11): WeMob 30% / posto 70% do faturamento bruto elegível. */
const terms = (o: Partial<ContractTerms> = {}): ContractTerms => ({
  contractId: "c1", contractNumber: "CTR-1", versionId: "v2", version: 2,
  royaltyRate: "0", royaltyBase: "GROSS_REVENUE", platformFeeRate: "0",
  partnerShareRate: "0.7", partnerShareBase: "GROSS_REVENUE", lossTreatment: "SHARE_MONTHLY", paymentTermDays: 10,
  revenueShareRate: "0.3", gatewayFeeBearer: "PENDING_DECISION", ...o,
});
const site = (o: Partial<SiteInput> = {}): SiteInput => ({
  siteId: "s1", siteName: "Posto", partnerOrganizationId: "p1", partnerName: "Parceiro", contract: terms(),
  stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "10000", paymentCount: 3 }], manualRevenue: [], expenses: [], lossCarriedIn: "0", ...o,
});

describe("participação 30/70 sobre o faturamento bruto", () => {
  it("cenários de referência (ilustrativos, não faturamento realizado)", () => {
    const scenarios: [string, string, string, string][] = [
      ["Conservador", "17928.00", "5378.40", "12549.60"],
      ["Moderado", "26892.00", "8067.60", "18824.40"],
      ["Realista", "35856.00", "10756.80", "25099.20"],
      ["Otimista", "53784.00", "16135.20", "37648.80"],
      ["Personalizado", "8964.00", "2689.20", "6274.80"],
    ];
    for (const [, gross, wemob, partner] of scenarios) expect(splitGross(gross, "0.3")).toEqual({ gross, wemob, partner });
  });

  it("conservação de centavos: as duas partes somam exatamente o bruto em qualquer valor", () => {
    for (let cents = 0; cents <= 5000; cents += 7) {
      const gross = new Decimal(cents).div(100);
      const r = splitGross(gross, "0.3");
      expect(new Decimal(r.wemob).plus(r.partner).toFixed(2)).toBe(gross.toFixed(2));
    }
    // meio centavo: 0,05 × 30% = 0,015 → 0,02 (meio para cima); posto fica com 0,03
    expect(splitGross("0.05", "0.3")).toEqual({ gross: "0.05", wemob: "0.02", partner: "0.03" });
  });

  it("sem taxa de sistema de 14% nem royalty: só a participação de 30% sai do bruto", () => {
    const l = computeSiteLine(site(), [{ name: "Simples", rate: "0.06" }]);
    expect(l).toMatchObject({ shareModel: "REVENUE_SHARE", gross: "10000.00", wemobShare: "3000.00", partnerGrossShare: "7000.00", platformFee: "0.00", royalty: "0.00", partnerShare: "7000.00", operatorResult: "3000.00" });
  });

  it("tributos e despesas da unidade aparecem à parte e não são descontados de nenhuma das partes", () => {
    const l = computeSiteLine(site({ expenses: [{ category: "ENERGY", amount: "2500" }] }), [{ name: "Simples", rate: "0.06" }]);
    expect(l).toMatchObject({ taxTotal: "600.00", expenses: "2500.00", partnerShare: "7000.00", wemobShare: "3000.00", operatorResult: "3000.00" });
    // informativos da unidade como um todo
    expect(l).toMatchObject({ netRevenue: "9400.00", operatingResult: "6900.00" });
  });

  it("tarifas do gateway: alocadas conforme o contrato; pendente = não alocadas", () => {
    const fees = { gatewayFees: "123.45" };
    expect(computeSiteLine(site({ ...fees }), [])).toMatchObject({ gatewayFeesUnallocated: "123.45", gatewayFeesWemob: "0.00", gatewayFeesPartner: "0.00", partnerShare: "7000.00", operatorResult: "3000.00" });
    expect(computeSiteLine(site({ ...fees, contract: terms({ gatewayFeeBearer: "WEMOB" }) }), [])).toMatchObject({ gatewayFeesWemob: "123.45", gatewayFeesUnallocated: "0.00", partnerShare: "7000.00", operatorResult: "2876.55" });
    expect(computeSiteLine(site({ ...fees, contract: terms({ gatewayFeeBearer: "PARTNER" }) }), [])).toMatchObject({ gatewayFeesPartner: "123.45", partnerShare: "6876.55", operatorResult: "3000.00" });
    // proporcional: 30% de 123,45 = 37,035 → 37,04 (WeMob); posto 86,41 — soma exata das tarifas
    const p = computeSiteLine(site({ ...fees, contract: terms({ gatewayFeeBearer: "PROPORTIONAL" }) }), []);
    expect(p).toMatchObject({ gatewayFeesWemob: "37.04", gatewayFeesPartner: "86.41", gatewayFeesUnallocated: "0.00", partnerShare: "6913.59", operatorResult: "2962.96" });
    expect(new Decimal(p.partnerShare).plus(p.operatorResult).plus(p.gatewayFees!).toFixed(2)).toBe("10000.00");
  });

  it("split já liquidado no gateway é abatido do saldo a repassar ao posto", () => {
    const l = computeSiteLine(site({ splitAlreadyTransferred: "6500" }), []);
    expect(l).toMatchObject({ partnerShare: "7000.00", partnerSplitReceived: "6500.00", partnerBalance: "500.00" });
  });

  it("bruto já líquido de estornos: estorno total zera as duas partes; estorno maior que o capturado gera parte negativa (devolução)", () => {
    expect(computeSiteLine(site({ stations: [{ stationId: "st1", identity: "CP-1", chargingRevenue: "0", paymentCount: 1 }] }), [])).toMatchObject({ wemobShare: "0.00", partnerShare: "0.00" });
    // ajuste negativo lançado (estorno após fechamento): as partes acompanham o sinal
    const adj = computeSiteLine(site({ stations: [], manualRevenue: [{ category: "CHARGING_REVENUE", amount: "-100" }] }), []);
    expect(adj).toMatchObject({ gross: "-100.00", wemobShare: "-30.00", partnerShare: "-70.00" });
  });

  it("contrato antigo (sem participação) continua no cálculo antigo — nada retroativo", () => {
    const old = computeSiteLine(site({ contract: terms({ revenueShareRate: null, royaltyRate: "0.05", platformFeeRate: "0.14", partnerShareRate: "1", partnerShareBase: "OPERATING_RESULT" }) }), []);
    expect(old.shareModel).toBeUndefined();
    expect(old).toMatchObject({ platformFee: "1400.00", royalty: "500.00" });
  });

  it("totais incluem participação, parte do posto e tarifas não alocadas; snapshots antigos somam zero nesses campos", () => {
    const a = computeSiteLine(site({ gatewayFees: "10" }), []);
    const b = computeSiteLine(site({ siteId: "s2", stations: [{ stationId: "x", identity: "X", chargingRevenue: "100.01", paymentCount: 1 }] }), []);
    const t = totals([a, b, { gross: "50.00", partnerShare: "10.00" }]);
    expect(t).toMatchObject({ wemobShare: "3030.00", partnerGrossShare: "7070.01", gatewayFeesUnallocated: "10.00", gross: "10150.01" });
    expect(SETTLEMENT_ENGINE_VERSION).toBe("settlement-1.3.0");
  });
});
