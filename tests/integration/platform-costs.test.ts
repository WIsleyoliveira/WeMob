import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSite, createStation } from "@/server/modules/stations/service";
import { cancelCostActual, deactivateCostItem, ensurePlatformCostDefaults, exportCostPlanXlsx, getCostPlan, recordCostActual, updateCostAssumptions, upsertCostItem } from "@/server/modules/costs/service";
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
