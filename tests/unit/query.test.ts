import { describe, expect, it } from "vitest";
import { hrefWith, pageParam, param } from "@/lib/query";

describe("endereços de listas com filtros", () => {
  it("mantém os filtros atuais, troca só o que mudou e tira vazios", () => {
    expect(hrefWith("/app/x", { q: "posto", status: "open", page: "3" }, { page: 1 })).toBe("/app/x?q=posto&status=open&page=1");
    expect(hrefWith("/app/x", { q: "", status: "open" }, { status: null })).toBe("/app/x");
    expect(hrefWith("/app/x", { tag: ["a", "b"] })).toBe("/app/x");
    expect(hrefWith("/app/x", {}, { q: "a&b" })).toBe("/app/x?q=a%26b");
  });
  it("página válida e parâmetros simples", () => {
    expect([pageParam(undefined), pageParam("2"), pageParam("0"), pageParam("x"), pageParam("1.5"), pageParam("99999")]).toEqual([1, 2, 1, 1, 1, 1]);
    expect(param({ a: "1", b: ["x"] }, "a")).toBe("1");
    expect(param({ a: "1", b: ["x"] }, "b")).toBeUndefined();
  });
});
