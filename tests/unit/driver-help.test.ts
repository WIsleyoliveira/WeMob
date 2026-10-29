import { describe, expect, it } from "vitest";
import { HELP_TOPICS, PHYSICAL_SAFETY_TEXT, parseHelpContext, supportSubject } from "@/domain/support/driver-help";
import { hasHistoryFilters, parseHistoryFilters, periodStart } from "@/domain/charging/history";

describe("histórico e ajuda contextual do motorista (P23 B4)", () => {
  it("filtros do histórico: válidos são lidos, inválidos ignorados", () => {
    expect(parseHistoryFilters({ periodo: "30", estacao: "SIM-E2E-AB12", estado: "encerrada" })).toEqual({ periodo: "30", estacao: "SIM-E2E-AB12", estado: "encerrada" });
    expect(parseHistoryFilters({ periodo: "365", estacao: "x' OR 1=1", estado: "pago" })).toEqual({ periodo: undefined, estacao: undefined, estado: undefined });
    expect(hasHistoryFilters(parseHistoryFilters({}))).toBe(false);
    expect(hasHistoryFilters(parseHistoryFilters({ periodo: "", estacao: "", estado: "" }))).toBe(false);
    const now = new Date("2026-10-29T12:00:00Z");
    expect(periodStart("7", now)?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(periodStart(undefined, now)).toBeUndefined();
  });

  it("contexto da ajuda vindo do link: ids e tipo validados", () => {
    expect(parseHelpContext({ sessao: "cmvsz7i8z006mz1mpca4dbwrz", tipo: "NAO_ENCERRA" })).toEqual({ sessao: "cmvsz7i8z006mz1mpca4dbwrz", pedido: undefined, tipo: "NAO_ENCERRA" });
    expect(parseHelpContext({ sessao: "../../etc", pedido: "<script>", tipo: "QUALQUER" })).toEqual({ sessao: undefined, pedido: undefined, tipo: undefined });
  });

  it("assunto do chamado começa pelo tipo; 'outro' usa só o texto; limite de 120", () => {
    expect(supportSubject("DUPLICADA", "")).toBe(HELP_TOPICS.DUPLICADA.label);
    expect(supportSubject("DUPLICADA", HELP_TOPICS.DUPLICADA.label)).toBe(HELP_TOPICS.DUPLICADA.label);
    expect(supportSubject("ESTORNO", "cartão final 1234")).toBe("Estorno ou devolução pendente: cartão final 1234");
    expect(supportSubject("OUTRO", "elogio")).toBe("elogio");
    expect(supportSubject(undefined, "  dúvida ")).toBe("dúvida");
    expect(supportSubject("VALOR_DIVERGENTE", "x".repeat(200))).toHaveLength(120);
  });

  it("orientações não prometem prazo nem sugerem mexer no equipamento", () => {
    for (const t of Object.values(HELP_TOPICS)) {
      expect(t.guidance).not.toMatch(/em até \d+ (horas?|minutos?)|24 ?h/i);
      expect(t.guidance).not.toMatch(/desligue o disjuntor|reinicie o carregador|abra o painel/i);
    }
    expect(PHYSICAL_SAFETY_TEXT).toMatch(/não toque/);
  });
});
