import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSite, createStation } from "@/server/modules/stations/service";
import { applyCostImport, cancelCostActual, costChangeHistory, deactivateCostItem, discardCostImport, ensurePlatformCostDefaults, exportCostPlanXlsx, freezeBudget, getCostImport, getCostPlan, listBudgetVersions, previewCostImport, recordCostActual, updateCostAssumptions, upsertCostItem, wemobEconomics } from "@/server/modules/costs/service";
import { buildXlsx } from "@/lib/xlsx";
import { previewClosing } from "@/server/modules/finance/closing";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const NOW = new Date("2026-11-15T12:00:00-03:00");

async function setup() {
  const op = await bootstrapOperator();
  await ensurePlatformCostDefaults(db, op.id);
  const admin = await createUser(op.id, "admin");
  const fin = await createUser(op.id, "finance");
  const commercial = await createUser(op.id, "commercial");
  return { op, admin, fin, commercial };
}

describe("custos operacionais da plataforma", () => {
  it("premissas da planilha carregadas uma única vez; sem postos de produção = só a plataforma (R$ 1.952,32)", async () => {
    const s = await setup();
    await ensurePlatformCostDefaults(db, s.op.id); // idempotente
    expect(await db.platformCostItem.count()).toBe(8);
    const v = await getCostPlan(s.fin.ctx, {}, NOW);
    expect(v.currentStations).toBe(0);
    expect(v.plan).toMatchObject({ stations: 0, totalMonthly: "1952.32", variableMonthly: "0.00" });
    expect(v.scenarios.find((x) => x.name === "Piloto")?.totalMonthly).toBe("2352.32");
    expect(v.history).toHaveLength(12);
    expect(v.history[0]).toMatchObject({ competence: "2026-11", state: "NO_ACTUAL" });
  });

  it("custo por posto conta só estações de PRODUÇÃO (teste/simulação não)", async () => {
    const s = await setup();
    const site = await createSite(s.admin.ctx, { name: "Posto" });
    await createStation(s.admin.ctx, { siteId: site.id, ocppIdentity: "CP-PROD-1", environment: "PRODUCTION" });
    await createStation(s.admin.ctx, { siteId: site.id, ocppIdentity: "CP-TEST-1", environment: "TEST" });
    await createStation(s.admin.ctx, { siteId: site.id, ocppIdentity: "CP-SIM-1", environment: "SIMULATED" });
    const v = await getCostPlan(s.fin.ctx, {}, NOW);
    expect(v.plan).toMatchObject({ stations: 1, totalMonthly: "2352.32" });
    expect((await getCostPlan(s.fin.ctx, { stations: 10 }, NOW)).plan.totalMonthly).toBe("5952.32"); // simulação
  });

  it("realizado em dólar convertido pelo câmbio informado; acima da tolerância = alerta; cancelado deixa de contar", async () => {
    const s = await setup();
    await recordCostActual(s.fin.ctx, { competence: "2026-11", itemKey: "app-api", category: "INFRASTRUCTURE", description: "Servidor — novembro", currency: "USD", originalAmount: 100, fxRate: 5.4321 });
    const reais = await recordCostActual(s.fin.ctx, { competence: "2026-11", category: "OPERATIONS", description: "Suporte — novembro", currency: "BRL", amount: 1700 });
    const usd = await db.platformCostActual.findFirstOrThrow({ where: { currency: "USD" } });
    expect([usd.amount.toString(), usd.originalAmount?.toString(), usd.fxRate?.toString()]).toEqual(["543.21", "100", "5.4321"]);
    let m = (await getCostPlan(s.fin.ctx, {}, NOW)).history[0];
    // orçado 1.952,32 (sem postos) × 1,10 = 2.147,55; realizado 2.243,21 → acima
    expect(m).toMatchObject({ actual: "2243.21", state: "OVER", variance: "290.89" });
    await cancelCostActual(s.fin.ctx, reais.id, "Lançado em duplicidade");
    m = (await getCostPlan(s.fin.ctx, {}, NOW)).history[0];
    expect(m).toMatchObject({ actual: "543.21", state: "WITHIN" });
    await expect(cancelCostActual(s.fin.ctx, reais.id, "de novo")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validação: dólar exige valor em US$ e câmbio; competência e item conferidos", async () => {
    const s = await setup();
    await expect(recordCostActual(s.fin.ctx, { competence: "2026-11", category: "SERVICES", description: "Mapas", currency: "USD", originalAmount: 10 })).rejects.toThrow();
    await expect(recordCostActual(s.fin.ctx, { competence: "2026-13", category: "SERVICES", description: "Mapas", amount: 10 })).rejects.toThrow();
    await expect(recordCostActual(s.fin.ctx, { competence: "2026-11", itemKey: "nao-existe", category: "SERVICES", description: "Mapas", amount: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordCostActual(s.fin.ctx, { competence: "2026-11", category: "SERVICES", description: "Mapas", amount: -5 })).rejects.toThrow();
  });

  it("premissas e itens editáveis com auditoria (antes/depois e justificativa)", async () => {
    const s = await setup();
    await updateCostAssumptions(s.fin.ctx, { fxStressRate: 0.2, reserveRate: 0.5, perStationCost: 300, perStationReserve: 100, budgetTolerance: 0.05, sourceNote: "Revisão com cotação de 11/2026" });
    await upsertCostItem(s.fin.ctx, { key: "app-api", name: "Servidor app e API", category: "INFRASTRUCTURE", baseMonthly: 300, fxExposure: 1 });
    await deactivateCostItem(s.fin.ctx, "maps");
    const v = await getCostPlan(s.fin.ctx, {}, NOW);
    expect(v.plan.lines.map((l) => l.key)).not.toContain("maps");
    expect(v.plan.lines.find((l) => l.key === "app-api")).toMatchObject({ base: "300.00", withFx: "360.00", reserve: "180.00" });
    const audits = await db.auditEvent.findMany({ where: { action: { startsWith: "platform_cost." } }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["platform_cost.assumptions_updated", "platform_cost.item_updated", "platform_cost.item_deactivated"]);
    expect(audits[1].data).toMatchObject({ before: { baseMonthly: "240" }, after: { baseMonthly: "300" } });
    await expect(updateCostAssumptions(s.fin.ctx, { fxStressRate: 0.2, reserveRate: 0.5, perStationCost: 300, perStationReserve: 100, budgetTolerance: 0.05 })).rejects.toThrow(); // sem justificativa
  });

  it("permissões: comercial não lê; parceiro não lê; leitura não edita", async () => {
    const s = await setup();
    const partnerOrg = await createOrg("Parceiro", "PARTNER");
    const partner = await createUser(partnerOrg.id, "partner");
    await expect(getCostPlan(s.commercial.ctx, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCostPlan(partner.ctx, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordCostActual(partner.ctx, { competence: "2026-11", category: "SERVICES", description: "x", amount: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("separação: custo da plataforma não entra no fechamento nem nas despesas da rede", async () => {
    const s = await setup();
    await recordCostActual(s.fin.ctx, { competence: "2026-09", category: "INFRASTRUCTURE", description: "Servidor — setembro", amount: 999 });
    const p = await previewClosing(s.fin.ctx, "2026-09");
    expect(p.result.networkExpenses).toEqual([]);
    expect(p.result.totals.networkExpenses).toBe("0.00");
    expect(await db.financialEntry.count()).toBe(0);
  });

  it("exportação do orçamento em Excel (finance:export), auditada", async () => {
    const s = await setup();
    const r = await exportCostPlanXlsx(s.fin.ctx, NOW);
    expect(r.filename).toBe("custos-plataforma-2026-11.xlsx");
    const xml = r.content.toString("utf8");
    expect(xml).toContain("TOTAL MENSAL PRUDENCIAL");
    expect(xml).toContain("<v>1952.32</v>");
    expect(xml).toContain("Rede maior");
    expect(await db.auditEvent.count({ where: { action: "platform_cost.exported" } })).toBe(1);
    await expect(exportCostPlanXlsx(s.commercial.ctx, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/** Planilha no layout da WeMob_Custos_Mensais_Detalhados.xlsx (gerada aqui; o leitor aceita ZIP com e sem compressão). */
function workbook(items: [string, string, number, number][], premises: [number, number, number, number] = [0.4, 0.6, 250, 150]) {
  return buildXlsx([
    { name: "Custos mensais", columns: [{ header: "Item" }, { header: "Categoria" }, { header: "Base R$/mes", type: "number" }, { header: "Exposicao cambial", type: "number" }], rows: [...items, ["TOTAL MENSAL", "", "", ""]] },
    { name: "Cenarios de custo", columns: [{ header: "Premissa" }, { header: "Valor", type: "number" }], rows: [["Alta cambial de stress", premises[0]], ["Reserva operacional sobre custo ajustado", premises[1]], ["Custo incremental mensal por posto", premises[2]], ["Reserva incremental por posto", premises[3]]] },
  ]);
}

describe("orçamento versionado por competência", () => {
  it("congelar o mês: nova versão substitui a anterior; o realizado passa a comparar com a versão, mesmo após mudar premissas", async () => {
    const s = await setup();
    const v1 = await freezeBudget(s.fin.ctx, { competence: "2026-11", reason: "Orçamento inicial de novembro" });
    expect(v1).toMatchObject({ version: 1, status: "ACTIVE", stations: 0 });
    expect(v1.totalMonthly.toString()).toBe("1952.32");
    await updateCostAssumptions(s.fin.ctx, { fxStressRate: 0.8, reserveRate: 0.6, perStationCost: 250, perStationReserve: 150, budgetTolerance: 0.1, sourceNote: "Dólar em alta (teste)" });
    let h = (await getCostPlan(s.fin.ctx, {}, NOW)).history[0];
    expect(h).toMatchObject({ competence: "2026-11", budgetSource: "VERSION", budgetVersion: 1, budget: "1952.32" }); // congelado não muda
    expect((await getCostPlan(s.fin.ctx, {}, NOW)).history[1]).toMatchObject({ competence: "2026-10", budgetSource: "CURRENT" });
    const v2 = await freezeBudget(s.fin.ctx, { competence: "2026-11", stations: 3, reason: "Revisão com o dólar de stress de 80%" });
    expect(v2.version).toBe(2);
    h = (await getCostPlan(s.fin.ctx, {}, NOW)).history[0];
    expect(h).toMatchObject({ budgetVersion: 2 });
    const versions = await listBudgetVersions(s.fin.ctx);
    expect(versions.map((x) => [x.competence, x.version, x.status])).toEqual([["2026-11", 2, "ACTIVE"], ["2026-11", 1, "SUPERSEDED"]]);
    expect(await db.platformCostBudget.count({ where: { status: "ACTIVE" } })).toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "platform_cost.budget_frozen" }, orderBy: { createdAt: "desc" } });
    expect(audit.data).toMatchObject({ version: 2, previous: { version: 1, totalMonthly: "1952.32" } });
  });

  it("comparação com o mês anterior no orçado e no realizado; histórico de alterações com o autor", async () => {
    const s = await setup();
    await freezeBudget(s.fin.ctx, { competence: "2026-10", reason: "Outubro" });
    await recordCostActual(s.fin.ctx, { competence: "2026-10", category: "OPERATIONS", description: "Outubro", amount: 1500 });
    await recordCostActual(s.fin.ctx, { competence: "2026-11", category: "OPERATIONS", description: "Novembro", amount: 1800 });
    const [nov, oct] = (await getCostPlan(s.fin.ctx, {}, NOW)).history;
    expect(oct).toMatchObject({ budgetSource: "VERSION", actual: "1500.00" });
    expect(nov).toMatchObject({ actualDelta: "300.00", budgetDelta: "0.00" });
    const changes = await costChangeHistory(s.fin.ctx);
    expect(changes.map((c) => c.action)).toEqual(["platform_cost.actual_recorded", "platform_cost.actual_recorded", "platform_cost.budget_frozen"]);
    expect(changes[0].actorName).toBe(s.fin.user.name);
  });

  it("concorrência: dois congelamentos simultâneos do mesmo mês deixam uma única versão ativa", async () => {
    const s = await setup();
    await Promise.all([freezeBudget(s.fin.ctx, { competence: "2026-12", reason: "Primeiro pedido" }), freezeBudget(s.admin.ctx, { competence: "2026-12", reason: "Segundo pedido" })]);
    expect(await db.platformCostBudget.count({ where: { competence: "2026-12" } })).toBe(2);
    expect(await db.platformCostBudget.count({ where: { competence: "2026-12", status: "ACTIVE" } })).toBe(1);
  });
});

describe("importação de nova versão da planilha", () => {
  it("prévia não altera nada; aplicar atualiza itens pelo nome, cria novos, retira ausentes e grava a origem", async () => {
    const s = await setup();
    const file = workbook([["Servidor app e API", "Infraestrutura", 300, 1], ["Banco PostgreSQL", "Infraestrutura", 140, 1], ["Suporte e manutencao", "Operacao", 407, 0], ["Notificações por e-mail", "Serviços", 80, 1]]);
    const imp = await previewCostImport(s.fin.ctx, { filename: "custos-dezembro.xlsx", bytes: file });
    expect(await db.platformCostItem.count({ where: { active: true } })).toBe(8); // nada mudou ainda
    const view = await getCostImport(s.fin.ctx, imp.id);
    expect(view.diff.find((d) => d.name === "Servidor app e API")).toMatchObject({ change: "CHANGED", before: { baseMonthly: "240" }, after: { baseMonthly: "300" } });
    expect(view.diff.find((d) => d.name === "Notificações por e-mail")?.change).toBe("NEW");
    expect(view.removed).toEqual(expect.arrayContaining(["Workers e automações", "Mapas e geolocalização"]));
    expect(view.current).toBe("1952.32");

    await applyCostImport(s.fin.ctx, imp.id, "Revisão de fornecedores de dezembro");
    const items = await db.platformCostItem.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    expect(items.map((i) => [i.key, i.baseMonthly.toString()])).toEqual([["app-api", "300"], ["postgres", "140"], ["support", "407"], ["notificacoes-por-e-mail", "80"]]);
    expect(await db.platformCostItem.count({ where: { active: false } })).toBe(5); // histórico mantido
    const a = await db.platformCostAssumptions.findFirstOrThrow();
    expect(a.sourceNote).toMatch(/^Planilha custos-dezembro\.xlsx \(sha256 [0-9a-f]{12}…\) importada em \d{4}-\d{2}-\d{2}: Revisão de fornecedores de dezembro$/);
    await expect(applyCostImport(s.fin.ctx, imp.id, "de novo, por engano")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.auditEvent.count({ where: { action: "platform_cost.import_applied" } })).toBe(1);
  });

  it("planilha inválida é recusada com o motivo; descartar encerra a prévia; sem finance:write não importa", async () => {
    const s = await setup();
    await expect(previewCostImport(s.fin.ctx, { filename: "x.xlsx", bytes: workbook([["Servidor", "Nuvem", 10, 1]]) })).rejects.toThrow(/categoria "Nuvem" desconhecida/);
    await expect(previewCostImport(s.fin.ctx, { filename: "x.xlsx", bytes: new TextEncoder().encode("não é planilha") })).rejects.toMatchObject({ code: "VALIDATION" });
    const imp = await previewCostImport(s.fin.ctx, { filename: "ok.xlsx", bytes: workbook([["Servidor app e API", "Infraestrutura", 240, 1]]) });
    await discardCostImport(s.fin.ctx, imp.id);
    await expect(applyCostImport(s.fin.ctx, imp.id, "aplicar descartada")).rejects.toMatchObject({ code: "CONFLICT" });
    const partnerOrg = await createOrg("Parceiro", "PARTNER");
    const partner = await createUser(partnerOrg.id, "partner");
    await expect(previewCostImport(partner.ctx, { filename: "ok.xlsx", bytes: workbook([["A", "Outros", 1, 0]]) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("economia da WeMob (visão lado a lado)", () => {
  it("participação só de meses fechados e aprovados; custo realizado do orçamento", async () => {
    const s = await setup();
    await recordCostActual(s.fin.ctx, { competence: "2026-11", category: "OPERATIONS", description: "Novembro", amount: 1200 });
    const e = await wemobEconomics(s.fin.ctx, 6, NOW);
    expect(e.rows).toHaveLength(6);
    expect(e.rows.at(-1)).toMatchObject({ competence: "2026-11", closed: false, wemobShare: null, platformCost: "1200.00" });
  });
});
