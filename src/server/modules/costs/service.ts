/**
 * Custos operacionais da PLATAFORMA WeMob: orçamento (itens + premissas), cenários, câmbio, custo por posto e
 * realizado × orçado. É DESPESA da WeMob: nada aqui entra no fechamento, nos repasses nem na participação de 30%.
 * Leitura: finance:read · edição de premissas e lançamentos: finance:write · exportação: finance:export.
 */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
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
  // Orçado do mês: a versão CONGELADA ativa da competência, quando existe; senão, as premissas atuais (marcado).
  const frozen = await db.platformCostBudget.findMany({ where: { operatorId: ctx.organizationId, status: "ACTIVE", competence: { in: competences } }, select: { competence: true, version: true, totalMonthly: true } });
  const frozenBy = new Map(frozen.map((f) => [f.competence, f]));
  const monthRows = competences.map((c) => {
    const rows = actuals.filter((x) => x.competence === c);
    const actual = rows.length ? rows.reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0)).toFixed(2) : null;
    const byCategory = COST_CATEGORIES.map((cat) => ({ category: cat, amount: rows.filter((x) => x.category === cat).reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0)).toFixed(2) })).filter((x) => x.amount !== "0.00");
    const f = frozenBy.get(c);
    const budget = f ? f.totalMonthly.toFixed(2) : plan.totalMonthly;
    return { competence: c, budget, budgetSource: f ? ("VERSION" as const) : ("CURRENT" as const), budgetVersion: f?.version ?? null, actual, byCategory, ...budgetCheck(budget, actual, tolerance) };
  });
  // Comparação com o mês anterior (a lista vem do mais recente para o mais antigo).
  const history = monthRows.map((h, i) => {
    const prev = monthRows[i + 1];
    return {
      ...h,
      budgetDelta: prev ? new Decimal(h.budget).minus(prev.budget).toFixed(2) : null,
      actualDelta: prev && h.actual !== null && prev.actual !== null ? new Decimal(h.actual).minus(prev.actual).toFixed(2) : null,
    };
  });
  return { plan, scenarios, fx, history, items, assumptions: raw, currentStations, entries: actuals };
}

const COMPETENCE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM.");

/**
 * Congela o orçamento de uma competência com as premissas e postos ATUAIS (nova versão; a anterior do mesmo mês fica
 * como substituída). O realizado × orçado daquele mês passa a usar esta versão, mesmo que as premissas mudem depois.
 */
export async function freezeBudget(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = z.object({ competence: COMPETENCE, stations: z.coerce.number().int().min(0).max(9999).optional(), reason: z.string().trim().min(5, "Informe o motivo.").max(500) }).parse(raw);
  const { inputs, assumptions, items, raw: a } = await loadPlan(ctx.organizationId);
  const stations = d.stations ?? (await productionStations(ctx.organizationId));
  const plan = computePlatformCosts(inputs, assumptions, stations);
  const snapshot = { items: items.map((i) => ({ key: i.key, name: i.name, category: i.category, baseMonthly: i.baseMonthly.toString(), fxExposure: i.fxExposure.toString() })), assumptions: { fxStressRate: a.fxStressRate.toString(), reserveRate: a.reserveRate.toString(), perStationCost: a.perStationCost.toString(), perStationReserve: a.perStationReserve.toString(), budgetTolerance: a.budgetTolerance.toString(), sourceNote: a.sourceNote } };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-budget:${ctx.organizationId}:${d.competence}`}))`;
    const last = await tx.platformCostBudget.findFirst({ where: { operatorId: ctx.organizationId, competence: d.competence }, orderBy: { version: "desc" } });
    if (last) await tx.platformCostBudget.updateMany({ where: { operatorId: ctx.organizationId, competence: d.competence, status: "ACTIVE" }, data: { status: "SUPERSEDED", supersededAt: new Date(), supersededById: ctx.userId } });
    const v = await tx.platformCostBudget.create({
      data: { operatorId: ctx.organizationId, competence: d.competence, version: (last?.version ?? 0) + 1, stations, snapshot, base: plan.totals.base, prudential: plan.totals.prudential, totalMonthly: plan.totalMonthly, reason: d.reason, createdById: ctx.userId },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.budget_frozen", entityType: "PlatformCostBudget", entityId: v.id, data: { competence: d.competence, version: v.version, totalMonthly: plan.totalMonthly, stations, previous: last ? { version: last.version, totalMonthly: last.totalMonthly.toString() } : null, reason: d.reason } }, tx);
    return v;
  });
}

export async function listBudgetVersions(ctx: AuthContext | null, limit = 24) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  return db.platformCostBudget.findMany({ where: { operatorId: ctx.organizationId }, orderBy: [{ competence: "desc" }, { version: "desc" }], take: limit, select: { id: true, competence: true, version: true, status: true, stations: true, base: true, prudential: true, totalMonthly: true, reason: true, createdAt: true, createdById: true } });
}

/** Histórico de alterações do orçamento (premissas, itens, versões, importações, lançamentos) — da auditoria. */
export async function costChangeHistory(ctx: AuthContext | null, limit = 30) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const rows = await db.auditEvent.findMany({ where: { organizationId: ctx.organizationId, action: { startsWith: "platform_cost." } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, action: true, data: true, createdAt: true, actorUserId: true } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, actorName: r.actorUserId ? (name.get(r.actorUserId) ?? "—") : "sistema" }));
}

// ── Importação de nova versão da planilha ──

const normName = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const slug = (v: string) => normName(v).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

/** Lê, valida e guarda a PRÉVIA da importação (nada muda no orçamento até "Aplicar"). */
export async function previewCostImport(ctx: AuthContext | null, file: { filename: string; bytes: Uint8Array }) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const buf = Buffer.from(file.bytes);
  const { readXlsx, XlsxReadError } = await import("@/lib/xlsx-read");
  const { parseCostWorkbook } = await import("@/domain/costs/import");
  let parsed;
  try {
    parsed = parseCostWorkbook(readXlsx(buf));
  } catch (e) {
    if (e instanceof XlsxReadError) throw new AppError("VALIDATION", e.message);
    throw new AppError("VALIDATION", "Não foi possível ler a planilha. Envie o arquivo .xlsx original.");
  }
  if (!parsed.ok) throw new AppError("VALIDATION", `Planilha recusada: ${parsed.errors.slice(0, 5).join(" ")}${parsed.errors.length > 5 ? ` (+${parsed.errors.length - 5})` : ""}`);
  const sha = createHash("sha256").update(buf).digest("hex");
  const imp = await db.platformCostImport.create({ data: { operatorId: ctx.organizationId, filename: file.filename.slice(0, 200), sha256: sha, bytes: buf.length, parsed: parsed.data as unknown as Prisma.InputJsonValue, createdById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.import_previewed", entityType: "PlatformCostImport", entityId: imp.id, data: { filename: imp.filename, sha256: sha, items: parsed.data.items.length } });
  return imp;
}

/** Prévia com a diferença em relação ao orçamento atual (item a item, premissas e total). */
export async function getCostImport(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const imp = await db.platformCostImport.findFirst({ where: { id, operatorId: ctx.organizationId } });
  if (!imp) throw notFound("Importação não encontrada.");
  const data = imp.parsed as unknown as import("@/domain/costs/import").ParsedCostWorkbook;
  const { items, inputs, assumptions } = await loadPlan(ctx.organizationId);
  const stations = await productionStations(ctx.organizationId);
  const current = computePlatformCosts(inputs, assumptions, stations);
  const next = computePlatformCosts(data.items.map((i) => ({ key: slug(i.name), name: i.name, category: i.category, baseMonthly: i.baseMonthly, fxExposure: i.fxExposure })), data.assumptions, stations);
  const byName = new Map(items.map((i) => [normName(i.name), i]));
  const diff = data.items.map((i) => {
    const cur = byName.get(normName(i.name));
    return { name: i.name, change: !cur ? ("NEW" as const) : cur.baseMonthly.toString() !== String(i.baseMonthly) || cur.fxExposure.toString() !== String(i.fxExposure) || cur.category !== i.category ? ("CHANGED" as const) : ("SAME" as const), before: cur ? { baseMonthly: cur.baseMonthly.toString(), fxExposure: cur.fxExposure.toString() } : null, after: { baseMonthly: String(i.baseMonthly), fxExposure: String(i.fxExposure) } };
  });
  const incoming = new Set(data.items.map((i) => normName(i.name)));
  const removed = items.filter((i) => !incoming.has(normName(i.name))).map((i) => i.name);
  return { import: imp, data, diff, removed, current: current.totalMonthly, next: next.totalMonthly, stations };
}

/** Aplica a prévia: itens (mesmo nome = atualiza; novo = cria; ausente = retira) e premissas, numa transação auditada. */
export async function applyCostImport(ctx: AuthContext | null, id: string, reason: string) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const why = z.string().trim().min(5, "Informe o motivo.").max(300).parse(reason);
  const view = await getCostImport(ctx, id);
  if (view.import.status !== "PREVIEW") throw new AppError("CONFLICT", "Esta importação já foi aplicada ou descartada.");
  const { data } = view;
  await db.$transaction(async (tx) => {
    const r = await tx.platformCostImport.updateMany({ where: { id, status: "PREVIEW" }, data: { status: "APPLIED", decidedById: ctx.userId, decidedAt: new Date(), reason: why } });
    if (r.count !== 1) throw new AppError("CONFLICT", "Esta importação já foi aplicada por outra pessoa.");
    const existing = await tx.platformCostItem.findMany({ where: { operatorId: ctx.organizationId } });
    const byName = new Map(existing.map((i) => [normName(i.name), i]));
    const usedKeys = new Set(existing.map((i) => i.key));
    const kept = new Set<string>();
    for (const [n, i] of data.items.entries()) {
      const cur = byName.get(normName(i.name));
      if (cur) {
        await tx.platformCostItem.update({ where: { id: cur.id }, data: { name: i.name, category: i.category, baseMonthly: i.baseMonthly, fxExposure: i.fxExposure, active: true, sortOrder: n, updatedById: ctx.userId } });
        kept.add(cur.id);
      } else {
        let key = slug(i.name);
        for (let k = 2; usedKeys.has(key); k++) key = `${slug(i.name).slice(0, 36)}-${k}`;
        usedKeys.add(key);
        const created = await tx.platformCostItem.create({ data: { operatorId: ctx.organizationId, key, name: i.name, category: i.category, baseMonthly: i.baseMonthly, fxExposure: i.fxExposure, sortOrder: n, updatedById: ctx.userId } });
        kept.add(created.id);
      }
    }
    await tx.platformCostItem.updateMany({ where: { operatorId: ctx.organizationId, active: true, id: { notIn: [...kept] } }, data: { active: false, updatedById: ctx.userId } });
    const note = `Planilha ${view.import.filename} (sha256 ${view.import.sha256.slice(0, 12)}…) importada em ${new Date().toISOString().slice(0, 10)}: ${why}`.slice(0, 500);
    await tx.platformCostAssumptions.update({ where: { operatorId: ctx.organizationId }, data: { ...data.assumptions, sourceNote: note, updatedById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.import_applied", entityType: "PlatformCostImport", entityId: id, data: { filename: view.import.filename, sha256: view.import.sha256, before: view.current, after: view.next, changed: view.diff.filter((x) => x.change !== "SAME").map((x) => x.name), removed: view.removed, reason: why } }, tx);
  });
}

export async function discardCostImport(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const r = await db.platformCostImport.updateMany({ where: { id, operatorId: ctx.organizationId, status: "PREVIEW" }, data: { status: "DISCARDED", decidedById: ctx.userId, decidedAt: new Date() } });
  if (r.count === 0) throw notFound("Importação não encontrada ou já decidida.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "platform_cost.import_discarded", entityType: "PlatformCostImport", entityId: id });
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

/**
 * Visão gerencial da WeMob por competência: participação nos fechamentos APROVADOS (receita 30/70) ao lado do custo
 * da plataforma (realizado e orçado). Só leitura — os dois números continuam em módulos separados e nada aqui
 * altera fechamento, repasse ou orçamento.
 */
export async function wemobEconomics(ctx: AuthContext | null, months = 6, now = new Date()) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const plan = await getCostPlan(ctx, { months }, now);
  const closings = await db.periodClosing.findMany({ where: { operatorId: ctx.organizationId, status: "APPROVED", period: { in: plan.history.map((h) => h.competence) } }, select: { period: true, result: true } });
  const byPeriod = new Map(closings.map((c) => [c.period, (c.result as { totals?: { wemobShare?: string; operatorResult?: string; gross?: string } }).totals ?? {}]));
  const rows = [...plan.history].reverse().map((h) => {
    const t = byPeriod.get(h.competence);
    return { competence: h.competence, closed: !!t, gross: t?.gross ?? null, wemobShare: t ? (t.wemobShare ?? "0.00") : null, platformCost: h.actual, budget: h.budget };
  });
  return { rows, currentMonthlyBudget: plan.plan.totalMonthly };
}
