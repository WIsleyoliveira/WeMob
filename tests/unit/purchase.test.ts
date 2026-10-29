import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseAmount, quoteByAmount, quoteByEnergy, readPurchaseRange, validatePurchaseAmount } from "@/domain/charging/purchase";
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
});
