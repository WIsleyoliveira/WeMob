import { describe, expect, it } from "vitest";
import { diffInputs } from "@/domain/viability/diff";

describe("diferença entre premissas", () => {
  it("lista só o que mudou, inclusive em objetos e listas", () => {
    const a = { pricePerKwh: 2.4, fixedMonthly: { rent: 0, connectivity: 150 }, chargers: [{ count: 1, powerKw: 60 }], versionStatusAtRun: "APPROVED" };
    const b = { pricePerKwh: 2.6, fixedMonthly: { rent: 500, connectivity: 150 }, chargers: [{ count: 2, powerKw: 60 }], versionStatusAtRun: "DRAFT", discountRateAnnual: 0.12 };
    expect(diffInputs(a, b)).toEqual([
      { path: "chargers[0].count", before: 1, after: 2 },
      { path: "discountRateAnnual", before: null, after: 0.12 },
      { path: "fixedMonthly.rent", before: 0, after: 500 },
      { path: "pricePerKwh", before: 2.4, after: 2.6 },
    ]);
  });
  it("entradas iguais não geram mudanças", () => {
    expect(diffInputs({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toEqual([]);
  });
});
