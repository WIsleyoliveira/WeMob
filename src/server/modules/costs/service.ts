/**
 * Custos operacionais da PLATAFORMA WeMob: orçamento (itens + premissas), cenários, câmbio, custo por posto e
 * realizado × orçado. É DESPESA da WeMob: nada aqui entra no fechamento, nos repasses nem na participação de 30%.
 * Leitura: finance:read · edição de premissas e lançamentos: finance:write · exportação: finance:export.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { COST_CATEGORIES, COST_CATEGORY_LABEL, budgetCheck, computePlatformCosts, costScenarios, fxSensitivity, type CostAssumptions, type CostItemInput } from "@/domain/costs/platform";
import { COST_SOURCE_NOTE, REFERENCE_COST_ASSUMPTIONS, REFERENCE_COST_ITEMS, REFERENCE_SCENARIOS } from "@/domain/costs/reference";
import { assertPeriod } from "@/domain/finance/period";
import { buildXlsx } from "@/lib/xlsx";

/** Premissas iniciais da planilha (só se a operadora ainda não tiver nenhuma). Idempotente. */
export async function ensurePlatformCostDefaults(client: PrismaClient, operatorId: string) {
  if (!(await client.platformCostAssumptions.findUnique({ where: { operatorId } }))) {
    const a = REFERENCE_COST_ASSUMPTIONS;
    await client.platformCostAssumptions.create({
      data: { operatorId, fxStressRate: String(a.fxStressRate), reserveRate: String(a.reserveRate), perStationCost: String(a.perStationCost), perStationReserve: String(a.perStationReserve), budgetTolerance: String(a.budgetTolerance), sourceNote: COST_SOURCE_NOTE },
    });
  }
  if ((await client.platformCostItem.count({ where: { operatorId } })) === 0) {
    await client.platformCostItem.createMany({ data: REFERENCE_COST_ITEMS.map((i, n) => ({ operatorId, ...i, baseMonthly: String(i.baseMonthly), fxExposure: String(i.fxExposure), sortOrder: n })) });
  }
}

async function loadPlan(operatorId: string) {
  const [items, a] = await Promise.all([
    db.platformCostItem.findMany({ where: { operatorId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.platformCostAssumptions.findUnique({ where: { operatorId } }),
  ]);
  if (!a) throw new AppError("CONFLICT", "Orçamento de custos não configurado: rode `npm run db:seed` para carregar as premissas da planilha.");
  const assumptions: CostAssumptions = { fxStressRate: a.fxStressRate.toString(), reserveRate: a.reserveRate.toString(), perStationCost: a.perStationCost.toString(), perStationReserve: a.perStationReserve.toString() };
  const inputs: CostItemInput[] = items.map((i) => ({ key: i.key, name: i.name, category: i.category, baseMonthly: i.baseMonthly.toString(), fxExposure: i.fxExposure.toString() }));
  return { items, inputs, assumptions, raw: a };
}

/** Postos em operação real: estações de PRODUÇÃO ativas (teste/simulação não geram custo incremental). */
const productionStations = (operatorId: string) => db.chargingStation.count({ where: { operatorId, environment: "PRODUCTION", deletedAt: null } });

export async function getCostPlan(ctx: AuthContext | null, opts: { stations?: number; months?: number } = {}, now = new Date()) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const { items, inputs, assumptions, raw } = await loadPlan(ctx.organizationId);
  const currentStations = await productionStations(ctx.organizationId);
  const stations = opts.stations ?? currentStations;
  const plan = computePlatformCosts(inputs, assumptions, stations);
  const scenarios = costScenarios(inputs, assumptions, [...REFERENCE_SCENARIOS, { name: "Rede atual (produção)", stations: currentStations }]);
  const fx = fxSensitivity(inputs, assumptions, [0, 0.2, 0.4, 0.6, 0.8]);

  // Histórico: realizado por mês × orçado com as premissas e postos ATUAIS (o orçamento não é versionado por mês).
  const months = Math.min(Math.max(opts.months ?? 12, 1), 36);
  const competences = Array.from({ length: months }, (_, k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const actuals = await db.platformCostActual.findMany({ where: { operatorId: ctx.organizationId, cancelledAt: null, competence: { in: competences } }, orderBy: [{ competence: "desc" }, { createdAt: "asc" }] });
  const tolerance = raw.budgetTolerance.toString();
  const history = competences.map((c) => {
    const rows = actuals.filter((x) => x.competence === c);
    const actual = rows.length ? rows.reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0)).toFixed(2) : null;
    const byCategory = COST_CATEGORIES.map((cat) => ({ category: cat, amount: rows.filter((x) => x.category === cat).reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0)).toFixed(2) })).filter((x) => x.amount !== "0.00");
    return { competence: c, budget: plan.totalMonthly, actual, byCategory, ...budgetCheck(plan.totalMonthly, actual, tolerance) };
  });
  return { plan, scenarios, fx, history, items, assumptions: raw, currentStations, entries: actuals };
}

const pctField = (max = 1) => z.coerce.number().min(0, "Mínimo 0").max(max, "Valor acima do permitido");
const money = z.coerce.number().min(0, "Valor não pode ser negativo").max(10_000_000);

export const costItemSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Use letras minúsculas, números e hífen (2–40)."),
  name: z.string().trim().min(2).max(120),
  category: z.enum(COST_CATEGORIES),
  baseMonthly: money,
  fxExposure: pctField(1),
});

export async function upsertCostItem(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = costItemSchema.parse(raw);
  const before = await db.platformCostItem.findUnique({ where: { operatorId_key: { operatorId: ctx.organizationId, key: d.key } } });
  const data = { name: d.name, category: d.category, baseMonthly: d.baseMonthly, fxExposure: d.fxExposure, active: true, updatedById: ctx.userId };
  const item = await db.platformCostItem.upsert({ where: { operatorId_key: { operatorId: ctx.organizationId, key: d.key } }, create: { operatorId: ctx.organizationId, key: d.key, ...data, sortOrder: 100 }, update: data });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: before ? "platform_cost.item_updated" : "platform_cost.item_created", entityType: "PlatformCostItem", entityId: item.id, data: { key: d.key, before: before ? { baseMonthly: before.baseMonthly.toString(), fxExposure: before.fxExposure.toString(), category: before.category, active: before.active } : null, after: { baseMonthly: String(d.baseMonthly), fxExposure: String(d.fxExposure), category: d.category } } });
  return item;
}

export async function deactivateCostItem(ctx: AuthContext | null, key: string) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const r = await db.platformCostItem.updateMany({ where: { operatorId: ctx.organizationId, key, active: true }, data: { active: false, updatedById: ctx.userId } });
  if (r.count === 0) throw notFound("Item não encontrado ou já desativado.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.item_deactivated", entityType: "PlatformCostItem", data: { key } });
}

export const assumptionsSchema = z.object({
  fxStressRate: pctField(3),
  reserveRate: pctField(3),
  perStationCost: money,
  perStationReserve: money,
  budgetTolerance: pctField(1),
  sourceNote: z.string().trim().min(5, "Informe a origem/justificativa da mudança.").max(500),
});

export async function updateCostAssumptions(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = assumptionsSchema.parse(raw);
  const before = await db.platformCostAssumptions.findUnique({ where: { operatorId: ctx.organizationId } });
  await db.platformCostAssumptions.upsert({ where: { operatorId: ctx.organizationId }, create: { operatorId: ctx.organizationId, ...d, updatedById: ctx.userId }, update: { ...d, updatedById: ctx.userId } });
  const snap = (x: typeof before) => x && { fxStressRate: x.fxStressRate.toString(), reserveRate: x.reserveRate.toString(), perStationCost: x.perStationCost.toString(), perStationReserve: x.perStationReserve.toString(), budgetTolerance: x.budgetTolerance.toString() };
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.assumptions_updated", entityType: "PlatformCostAssumptions", entityId: ctx.organizationId, data: { before: snap(before), after: { ...d, sourceNote: undefined }, note: d.sourceNote } });
}

export const actualSchema = z
  .object({
    competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM."),
    itemKey: z.string().trim().optional().transform((v) => v || undefined),
    category: z.enum(COST_CATEGORIES),
    description: z.string().trim().min(3).max(200),
    currency: z.enum(["BRL", "USD"]).default("BRL"),
    amount: z.coerce.number().positive("Informe o valor.").max(10_000_000).optional(),
    originalAmount: z.coerce.number().positive().max(10_000_000).optional(),
    fxRate: z.coerce.number().gt(0).max(100).optional(),
  })
  .superRefine((v, c) => {
    if (v.currency === "USD" && (v.originalAmount === undefined || v.fxRate === undefined)) c.addIssue({ code: "custom", path: ["fxRate"], message: "Fatura em dólar: informe o valor em US$ e o câmbio usado." });
    if (v.currency === "BRL" && v.amount === undefined) c.addIssue({ code: "custom", path: ["amount"], message: "Informe o valor em R$." });
  });

/** Custo realizado do mês. Em dólar, o valor em R$ é calculado (US$ × câmbio, 2 casas) e o original fica guardado. */
export async function recordCostActual(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = actualSchema.parse(raw);
  assertPeriod(d.competence);
  if (d.itemKey && !(await db.platformCostItem.findUnique({ where: { operatorId_key: { operatorId: ctx.organizationId, key: d.itemKey } } }))) throw notFound("Item de custo não encontrado.");
  const amount = d.currency === "USD" ? new Decimal(d.originalAmount!).times(d.fxRate!).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : new Decimal(d.amount!).toFixed(2);
  const row = await db.platformCostActual.create({
    data: { operatorId: ctx.organizationId, competence: d.competence, itemKey: d.itemKey, category: d.category, description: d.description, amount, currency: d.currency, originalAmount: d.currency === "USD" ? d.originalAmount : null, fxRate: d.currency === "USD" ? d.fxRate : null, createdById: ctx.userId },
  });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.actual_recorded", entityType: "PlatformCostActual", entityId: row.id, data: { competence: d.competence, amount, currency: d.currency } });
  return row;
}

export async function cancelCostActual(ctx: AuthContext | null, id: string, reason: string) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const why = z.string().trim().min(5, "Informe o motivo.").max(300).parse(reason);
  const r = await db.platformCostActual.updateMany({ where: { id, operatorId: ctx.organizationId, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: why } });
  if (r.count === 0) throw notFound("Lançamento não encontrado ou já cancelado.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.actual_cancelled", entityType: "PlatformCostActual", entityId: id, data: { reason: why } });
}

/** Planilha do orçamento (itens, cenários, câmbio e histórico) — Excel nativo, auditada. */
export async function exportCostPlanXlsx(ctx: AuthContext | null, now = new Date()) {
  requirePermission(ctx, "finance:export");
  const v = await getCostPlan(ctx, {}, now);
  const content = buildXlsx([
    {
      name: "Custos mensais",
      columns: [{ header: "Item" }, { header: "Categoria" }, { header: "Base (R$/mês)", type: "money" }, { header: "Exposição cambial", type: "number" }, { header: "Com câmbio de stress (R$)", type: "money" }, { header: "Reserva operacional (R$)", type: "money" }, { header: "Custo prudencial (R$)", type: "money" }],
      rows: [
        ...v.plan.lines.map((l) => [l.name, COST_CATEGORY_LABEL[l.category], l.base, l.fxExposure, l.withFx, l.reserve, l.prudential]),
        ["TOTAL DA PLATAFORMA", "", v.plan.totals.base, "", v.plan.totals.withFx, v.plan.totals.reserve, v.plan.totals.prudential],
        [`Postos em produção (${v.plan.stations} × R$ ${v.plan.perStationUnit})`, "Por posto", "", "", "", "", v.plan.variableMonthly],
        ["TOTAL MENSAL PRUDENCIAL", "", "", "", "", "", v.plan.totalMonthly],
      ],
    },
    { name: "Cenários", columns: [{ header: "Cenário" }, { header: "Postos", type: "integer" }, { header: "Base (R$)", type: "money" }, { header: "Plataforma com stress + reserva (R$)", type: "money" }, { header: "Custo dos postos (R$)", type: "money" }, { header: "Total mensal (R$)", type: "money" }], rows: v.scenarios.map((s) => [s.name, s.stations, s.base, s.prudential, s.stationsCost, s.totalMonthly]) },
    { name: "Câmbio", columns: [{ header: "Alta do dólar", type: "number" }, { header: "Plataforma prudencial (R$)", type: "money" }], rows: v.fx.map((x) => [x.fxStressRate, x.prudential]) },
    { name: "Realizado x orçado", columns: [{ header: "Competência" }, { header: "Orçado (R$)", type: "money" }, { header: "Realizado (R$)", type: "money" }, { header: "Diferença (R$)", type: "money" }, { header: "Situação" }], rows: v.history.map((h) => [h.competence, h.budget, h.actual ?? "", h.variance ?? "", h.state === "OVER" ? "acima do orçado" : h.state === "WITHIN" ? "dentro do orçado" : "sem lançamento"]) },
    { name: "Premissas", columns: [{ header: "Premissa" }, { header: "Valor", type: "number" }], rows: [["Alta cambial de stress", v.assumptions.fxStressRate.toString()], ["Reserva operacional", v.assumptions.reserveRate.toString()], ["Custo incremental por posto (R$)", v.assumptions.perStationCost.toString()], ["Reserva por posto (R$)", v.assumptions.perStationReserve.toString()], ["Tolerância do alerta de orçamento", v.assumptions.budgetTolerance.toString()], [`Origem: ${v.assumptions.sourceNote ?? "—"}`, ""]] },
  ]);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.exported", entityType: "PlatformCostAssumptions", entityId: ctx.organizationId, data: { format: "xlsx" } });
  return { filename: `custos-plataforma-${now.toISOString().slice(0, 7)}.xlsx`, content };
}
