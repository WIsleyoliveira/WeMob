import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { B3_EXAMPLE, isProductionGateway, parseAmount, purchaseConfigForStation, quoteByAmount, quoteByEnergy, readPurchaseConfig, readPurchaseRange, validatePurchaseAmount } from "@/domain/charging/purchase";
import { sessionLimit } from "@/domain/charging/limit";

const kwhOnly = { pricePerKwh: "2.4000", pricePerMin: "0" };
const withTime = { pricePerKwh: "2.0000", pricePerMin: "0.1000" };

describe("B3 — compra por valor ou kWh (regra preparatória, sem limites comerciais)", () => {
  it("sem faixa configurada a escolha fica bloqueada (nenhum padrão inventado)", () => {
    for (const env of [{}, { CHARGE_AMOUNT_MIN: "10" }, { CHARGE_AMOUNT_MAX: "100" }, { CHARGE_AMOUNT_MIN: "", CHARGE_AMOUNT_MAX: "" }]) {
      const r = readPurchaseRange(env);
      expect(r.status).toBe("UNDEFINED");
      expect(validatePurchaseAmount("50", r)).toEqual([expect.stringMatching(/não definida/)]);
    }
  });

  it("faixa mal configurada também bloqueia (formato, zero, mínimo maior que máximo)", () => {
    for (const env of [{ CHARGE_AMOUNT_MIN: "abc", CHARGE_AMOUNT_MAX: "10" }, { CHARGE_AMOUNT_MIN: "0", CHARGE_AMOUNT_MAX: "10" }, { CHARGE_AMOUNT_MIN: "50", CHARGE_AMOUNT_MAX: "10" }, { CHARGE_AMOUNT_MIN: "1.005", CHARGE_AMOUNT_MAX: "10" }]) {
      expect(readPurchaseRange(env)).toMatchObject({ status: "UNDEFINED", reason: expect.stringMatching(/mal configurada/) });
    }
  });

  it("com faixa definida (valores de teste, não comerciais) valida limites e casas decimais", () => {
    const range = readPurchaseRange({ CHARGE_AMOUNT_MIN: "1.00", CHARGE_AMOUNT_MAX: "9.99" });
    expect(range.status).toBe("DEFINED");
    expect(validatePurchaseAmount("1.00", range)).toEqual([]);
    expect(validatePurchaseAmount("9.99", range)).toEqual([]);
    expect(validatePurchaseAmount("0.99", range)[0]).toMatch(/abaixo do mínimo/);
    expect(validatePurchaseAmount("10", range)[0]).toMatch(/acima do máximo/);
    expect(validatePurchaseAmount("5.555", range)[0]).toMatch(/2 casas/);
    expect(validatePurchaseAmount("xyz", range)[0]).toMatch(/inválido/);
  });

  it("só aceita reais escritos como número decimal simples (sem hexadecimal, notação científica, sinal ou separador)", () => {
    const range = readPurchaseRange({ CHARGE_AMOUNT_MIN: "1.00", CHARGE_AMOUNT_MAX: "200.00" });
    for (const v of ["0x10", "0b11", "0o7", "1e2", "5e1", "+50", "1_000", "50 ", " 50", "1.234,5", "12,", ".5", "Infinity", "NaN", "-0", "٥٠", ""]) {
      expect(parseAmount(v), v).toBeNull();
      expect(validatePurchaseAmount(v, range), v).toEqual([expect.stringMatching(/inválido/)]);
    }
    expect(parseAmount("50")?.toFixed(2)).toBe("50.00");
    expect(parseAmount("37,5")?.toFixed(2)).toBe("37.50");
    expect(parseAmount("37.55")?.toFixed(2)).toBe("37.55");
    expect(parseAmount("050")?.toFixed(2)).toBe("50.00");
    expect(validatePurchaseAmount("0,50", range)).toEqual(["Valor abaixo do mínimo por recarga (R$ 1,00)."]); // mensagem em pt-BR
    expect(validatePurchaseAmount("250", range)).toEqual(["Valor acima do máximo por recarga (R$ 200,00)."]);
  });

  it("por valor: energia estimada pelo LIMITE da sessão (valor − margem), arredondada para baixo", () => {
    const q = quoteByAmount("50", kwhOnly, 0.1);
    expect(q.limit.toFixed(2)).toBe("45.00"); // mesma regra do limite em vigor
    expect(q.limit.eq(sessionLimit("50", 0.1))).toBe(true);
    expect(q.maxEnergyKwh?.toFixed(3)).toBe("18.750"); // 45 / 2,40
    expect(quoteByAmount("10", { pricePerKwh: "3", pricePerMin: "0" }, 0.1).maxEnergyKwh?.toFixed(3)).toBe("3.000");
    expect(quoteByAmount("10", { pricePerKwh: "2.4", pricePerMin: "0" }, 0.1).maxEnergyKwh?.toFixed(3)).toBe("3.750");
  });

  it("por valor com tarifa por minuto: sem estimativa de energia (depende da duração)", () => {
    const q = quoteByAmount("50", withTime, 0.1);
    expect(q.estimateAvailable).toBe(false);
    expect(q.maxEnergyKwh).toBeNull();
  });

  it("por kWh: menor valor cujo limite cobre a energia pedida; indisponível com tarifa por minuto", () => {
    const q = quoteByEnergy("10", kwhOnly, 0.1);
    expect(q.supported).toBe(true);
    if (!q.supported) return;
    expect(q.energyCost.toFixed(2)).toBe("24.00");
    expect(q.limit.gte(q.energyCost)).toBe(true);
    expect(sessionLimit(q.charged.minus("0.01"), 0.1).lt(q.energyCost)).toBe(true); // um centavo a menos não cobriria
    expect(q.charged.toFixed(2)).toBe("26.67");
    for (const kwh of ["0.5", "7.3", "33.333", "60"]) {
      const r = quoteByEnergy(kwh, { pricePerKwh: "1.99", pricePerMin: "0" }, 0.1);
      if (!r.supported) throw new Error("deveria suportar");
      expect(r.limit.gte(r.energyCost)).toBe(true);
      expect(sessionLimit(r.charged.minus("0.01"), 0.1).lt(r.energyCost)).toBe(true);
    }
    expect(quoteByEnergy("10", withTime, 0.1)).toMatchObject({ supported: false });
    expect(quoteByEnergy("10", { pricePerKwh: "0", pricePerMin: "0" }, 0.1)).toMatchObject({ supported: false });
  });

  it("valores em Decimal (sem erro de ponto flutuante)", () => {
    expect(quoteByAmount("0.30", { pricePerKwh: "0.1", pricePerMin: "0" }, 0.1).maxEnergyKwh?.toFixed(3)).toBe(new Decimal("0.27").div("0.1").toFixed(3));
  });

  it("perfis por ambiente: desligado por padrão; faixa sozinha não liga; modo desconhecido desliga", () => {
    expect(readPurchaseConfig({})).toMatchObject({ status: "DISABLED" });
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MODE: "off", CHARGE_AMOUNT_MIN: "1", CHARGE_AMOUNT_MAX: "9" })).toMatchObject({ status: "DISABLED" });
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MIN: "1", CHARGE_AMOUNT_MAX: "9" })).toMatchObject({ status: "DISABLED" });
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MODE: "ligado" })).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/desconhecido/) });
  });

  it("perfil EXAMPLE: valores de exemplo só sem gateway de produção; nunca em estação de produção", () => {
    const ex = readPurchaseConfig({ CHARGE_AMOUNT_MODE: "example", ASAAS_ENVIRONMENT: "sandbox" });
    expect(ex).toMatchObject({ status: "ENABLED", source: "EXAMPLE" });
    if (ex.status !== "ENABLED") throw new Error();
    expect([ex.min.toFixed(2), ex.max.toFixed(2), ex.suggested?.toFixed(2)]).toEqual([B3_EXAMPLE.min, B3_EXAMPLE.max, B3_EXAMPLE.suggested]);
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MODE: "example", ASAAS_ENVIRONMENT: "production" })).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/exemplo/) });
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MODE: "example", ASAAS_PRODUCTION_ENABLED: "1" })).toMatchObject({ status: "DISABLED" });
    expect(purchaseConfigForStation(ex, "PRODUCTION")).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/estações reais/) });
    expect(purchaseConfigForStation(ex, "TEST")).toMatchObject({ status: "ENABLED" });
    expect(isProductionGateway({ ASAAS_ENVIRONMENT: "Production " })).toBe(true);
  });

  it("perfil CONFIGURED: faixa obrigatória; produção exige a referência da aprovação da WAPE; sugerido validado", () => {
    expect(readPurchaseConfig({ CHARGE_AMOUNT_MODE: "configured" })).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/não definida/) });
    const sandbox = readPurchaseConfig({ CHARGE_AMOUNT_MODE: "configured", CHARGE_AMOUNT_MIN: "10.00", CHARGE_AMOUNT_MAX: "80.00", ASAAS_ENVIRONMENT: "sandbox" });
    expect(sandbox).toMatchObject({ status: "ENABLED", source: "CONFIGURED", approvalRef: null });
    const prodEnv = { CHARGE_AMOUNT_MODE: "configured", CHARGE_AMOUNT_MIN: "10.00", CHARGE_AMOUNT_MAX: "80.00", ASAAS_ENVIRONMENT: "production" };
    expect(readPurchaseConfig(prodEnv)).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/aprovação formal/) });
    expect(readPurchaseConfig({ ...prodEnv, CHARGE_AMOUNT_APPROVAL_REF: "x" })).toMatchObject({ status: "DISABLED" }); // referência curta demais
    expect(readPurchaseConfig({ ...prodEnv, CHARGE_AMOUNT_APPROVAL_REF: "WAPE-DEC-2026-001" })).toMatchObject({ status: "ENABLED", approvalRef: "WAPE-DEC-2026-001" });
    expect(purchaseConfigForStation(readPurchaseConfig({ ...prodEnv, CHARGE_AMOUNT_APPROVAL_REF: "WAPE-DEC-2026-001" }), "PRODUCTION")).toMatchObject({ status: "ENABLED" });
    expect(readPurchaseConfig({ ...prodEnv, CHARGE_AMOUNT_APPROVAL_REF: "WAPE-DEC-2026-001", CHARGE_AMOUNT_SUGGESTED: "90" })).toMatchObject({ status: "DISABLED", reason: expect.stringMatching(/sugerido/) });
    expect(readPurchaseConfig({ ...prodEnv, CHARGE_AMOUNT_APPROVAL_REF: "WAPE-DEC-2026-001", CHARGE_AMOUNT_SUGGESTED: "40" })).toMatchObject({ status: "ENABLED" });
  });

  it("exemplo do pedido: R$ 50 a R$ 2,00/kWh equivale a 25 kWh, mas a recarga para em R$ 45 (margem 10%) → até 22,5 kWh", () => {
    const q = quoteByAmount("50", { pricePerKwh: "2", pricePerMin: "0" }, 0.1);
    expect(new Decimal(50).div(2).toFixed(1)).toBe("25.0");
    expect(q.limit.toFixed(2)).toBe("45.00");
    expect(q.maxEnergyKwh?.toFixed(1)).toBe("22.5");
  });
});
