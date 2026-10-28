import { describe, expect, it } from "vitest";
import { estimateDistribution, validateForCharge, validatePolicy } from "@/domain/payments/split";

describe("split — regras do Asaas (percentual sobre o líquido)", () => {
  it("valida casas decimais (percentual 4, fixo 2), faixa e soma ≤ 100%", () => {
    expect(validatePolicy([{ label: "Parceiro", percentualValue: "50" }])).toEqual([]);
    expect(validatePolicy([{ label: "P", percentualValue: "12.34567" }]).join()).toMatch(/4 casas/);
    expect(validatePolicy([{ label: "P", fixedValue: "1.234" }]).join()).toMatch(/2 casas/);
    expect(validatePolicy([{ label: "P", percentualValue: "0" }]).join()).toMatch(/entre 0 e 100/);
    expect(validatePolicy([{ label: "A", percentualValue: "60" }, { label: "B", percentualValue: "40.0001" }]).join()).toMatch(/ultrapassa 100%/);
    expect(validatePolicy([{ label: "P" }]).join()).toMatch(/percentual ou valor fixo/);
    expect(validatePolicy([]).join()).toMatch(/ao menos um/);
  });

  it("50% no split é 50% do LÍQUIDO (R$ 100 com tarifa R$ 2,48 → R$ 48,76), arredondado por linha; o resíduo fica com a emissora", () => {
    const d = estimateDistribution("97.52", [{ label: "Parceiro", percentualValue: "50" }]);
    expect(d).toMatchObject({ net: "97.52", distributed: "48.76", residual: "48.76", divergent: false });
    const r = estimateDistribution("4.01", [{ label: "A", percentualValue: "33.3333" }, { label: "B", percentualValue: "33.3333" }]);
    expect(r.lines.map((l) => l.amount)).toEqual(["1.34", "1.34"]); // 1,3366… → HALF_UP 1,34
    expect(r.residual).toBe("1.33");
  });

  it("fixo + percentual acima do líquido é divergente (Asaas bloqueia); fixo maior que o valor cobrado é recusado antes de cobrar", () => {
    expect(estimateDistribution("98", [{ label: "A", fixedValue: "50" }, { label: "B", percentualValue: "50" }]).divergent).toBe(true);
    expect(validateForCharge("5.00", [{ label: "A", fixedValue: "5" }]).join()).toMatch(/não cabem/);
    expect(validateForCharge("100.00", [{ label: "A", fixedValue: "10" }])).toEqual([]);
  });
});
