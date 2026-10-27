/**
 * Contas a pagar/receber. OPEN = provisionado; PAID = baixa registrada manualmente após o
 * pagamento/recebimento ter ocorrido fora da plataforma (nenhuma transferência é iniciada aqui).
 * Lançamentos de período fechado não são criados, editados nem cancelados: usa-se ajuste.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import type { EntryCategory, EntryKind, EntryStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { PERIOD_RE, periodOf } from "@/domain/finance/period";
import { isPeriodClosed, lockOpenPeriod } from "./periods";

export const CATEGORY_LABEL: Record<EntryCategory, string> = {
  CHARGING_REVENUE: "Receita de recarga (externa)",
  OTHER_REVENUE: "Outras receitas",
  ENERGY: "Energia",
  RENT: "Aluguel / cessão de espaço",
  MAINTENANCE: "Manutenção",
  CONNECTIVITY: "Conectividade",
  INSURANCE: "Seguro",
  OTHER_EXPENSE: "Outras despesas",
  PARTNER_SHARE: "Repasse ao parceiro",
  PARTNER_CONTRIBUTION: "Aporte do parceiro",
  ADJUSTMENT: "Ajuste de período fechado",
};
export const KIND_LABEL: Record<EntryKind, string> = { RECEIVABLE: "A receber", PAYABLE: "A pagar" };
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { OPEN: "Provisionado / em aberto", PAID: "Baixado (pago/recebido)", CANCELLED: "Cancelado" };

export const REVENUE_CATEGORIES: EntryCategory[] = ["CHARGING_REVENUE", "OTHER_REVENUE"];
export const EXPENSE_CATEGORIES: EntryCategory[] = ["ENERGY", "RENT", "MAINTENANCE", "CONNECTIVITY", "INSURANCE", "OTHER_EXPENSE"];
/** Categorias que entram no cálculo do fechamento (as geradas pelo fechamento/ajuste não entram). */
export const OPERATING_CATEGORIES = [...REVENUE_CATEGORIES, ...EXPENSE_CATEGORIES];

const money = z.coerce.number().gt(0, "Informe um valor positivo.").max(1e10).transform((v) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));

export const entrySchema = z
  .object({
    category: z.enum(OPERATING_CATEGORIES as [EntryCategory, ...EntryCategory[]]),
    description: z.string().trim().min(3).max(300),
    amount: money,
    competence: z.string().regex(PERIOD_RE, "Use AAAA-MM."),
    dueDate: z.coerce.date().optional(),
    siteId: z.string().optional().transform((v) => v || undefined),
    stationId: z.string().optional().transform((v) => v || undefined),
  });

export async function createEntry(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = entrySchema.parse(raw);
  const kind: EntryKind = REVENUE_CATEGORIES.includes(d.category) ? "RECEIVABLE" : "PAYABLE";
  if (d.siteId && !(await db.site.findFirst({ where: { id: d.siteId, operatorId: ctx.organizationId, deletedAt: null } }))) throw notFound("Unidade não encontrada.");
  if (d.stationId) {
    const st = await db.chargingStation.findFirst({ where: { id: d.stationId, operatorId: ctx.organizationId, deletedAt: null } });
    if (!st) throw notFound("Estação não encontrada.");
    if (d.siteId && st.siteId !== d.siteId) throw new AppError("VALIDATION", "A estação não pertence à unidade informada.");
    d.siteId = st.siteId;
  }
  return db.$transaction(async (tx) => {
    await lockOpenPeriod(tx, ctx.organizationId, d.competence);
    const e = await tx.financialEntry.create({ data: { ...d, kind, operatorId: ctx.organizationId, createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.entry_created", entityType: "FinancialEntry", entityId: e.id, data: { kind, category: d.category, amount: d.amount, competence: d.competence } }, tx);
    return e;
  });
}

/** Baixa manual: registra que o valor foi pago/recebido FORA da plataforma. */
export async function settleEntry(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = z.object({ entryId: z.string(), paidAt: z.coerce.date(), paidAmount: money, note: z.string().trim().min(3, "Informe a referência do pagamento (ex.: comprovante).").max(300) }).parse(raw);
  if (d.paidAt > new Date()) throw new AppError("VALIDATION", "A data da baixa não pode estar no futuro.");
  const r = await db.financialEntry.updateMany({
    where: { id: d.entryId, operatorId: ctx.organizationId, status: "OPEN" },
    data: { status: "PAID", paidAt: d.paidAt, paidAmount: d.paidAmount, paymentNote: d.note, paidById: ctx.userId },
  });
  if (r.count !== 1) throw new AppError("CONFLICT", "Lançamento inexistente ou não está em aberto.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.entry_settled", entityType: "FinancialEntry", entityId: d.entryId, data: { paidAmount: d.paidAmount, paidAt: d.paidAt.toISOString(), note: d.note } });
}

export async function cancelEntry(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:write");
  requireOperator(ctx);
  const d = z.object({ entryId: z.string(), reason: z.string().trim().min(5, "Informe o motivo.").max(300) }).parse(raw);
  const e = await db.financialEntry.findFirst({ where: { id: d.entryId, operatorId: ctx.organizationId } });
  if (!e) throw notFound("Lançamento não encontrado.");
  if (e.source === "CLOSING") throw new AppError("CONFLICT", "Lançamento gerado por fechamento não é cancelado: registre um ajuste.");
  await db.$transaction(async (tx) => {
    await lockOpenPeriod(tx, ctx.organizationId, e.competence);
    const r = await tx.financialEntry.updateMany({ where: { id: e.id, status: "OPEN" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: d.reason } });
    if (r.count !== 1) throw new AppError("CONFLICT", "Somente lançamentos em aberto podem ser cancelados.");
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.entry_cancelled", entityType: "FinancialEntry", entityId: e.id, data: { reason: d.reason } }, tx);
  });
}

/**
 * Ajuste de período fechado: correção do saldo com o parceiro (a pagar ou a receber),
 * lançada em período ABERTO e ligada ao período corrigido. O fechamento original permanece intacto.
 */
export async function createAdjustment(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:close");
  requireOperator(ctx);
  const d = z
    .object({
      adjustsPeriod: z.string().regex(PERIOD_RE),
      contractId: z.string().min(1, "Selecione o contrato."),
      kind: z.enum(["PAYABLE", "RECEIVABLE"]),
      amount: money,
      description: z.string().trim().min(10, "Descreva o motivo do ajuste.").max(500),
    })
    .parse(raw);
  if (!(await isPeriodClosed(ctx.organizationId, d.adjustsPeriod))) throw new AppError("VALIDATION", "Ajuste só se aplica a período fechado. Em período aberto, corrija o lançamento.");
  const contract = await db.contract.findFirst({ where: { id: d.contractId, operatorId: ctx.organizationId } });
  if (!contract) throw notFound("Contrato não encontrado.");
  const competence = periodOf(new Date());
  return db.$transaction(async (tx) => {
    await lockOpenPeriod(tx, ctx.organizationId, competence);
    const e = await tx.financialEntry.create({
      data: {
        operatorId: ctx.organizationId, kind: d.kind, category: "ADJUSTMENT", source: "ADJUSTMENT", description: d.description, amount: d.amount,
        competence, adjustsPeriod: d.adjustsPeriod, contractId: contract.id, partnerOrganizationId: contract.partnerOrganizationId, createdById: ctx.userId,
      },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.adjustment_created", entityType: "FinancialEntry", entityId: e.id, data: { adjustsPeriod: d.adjustsPeriod, kind: d.kind, amount: d.amount, contract: contract.number } }, tx);
    return e;
  });
}

export const entryFilterSchema = z.object({
  competence: z.string().regex(PERIOD_RE).optional(),
  kind: z.enum(["RECEIVABLE", "PAYABLE"]).optional(),
  status: z.enum(["OPEN", "PAID", "CANCELLED"]).optional(),
});

export function entryWhere(operatorId: string, f: z.infer<typeof entryFilterSchema>): Prisma.FinancialEntryWhereInput {
  return { operatorId, ...(f.competence ? { competence: f.competence } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.status ? { status: f.status } : {}) };
}

export async function listEntries(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const f = entryFilterSchema.parse(raw);
  return db.financialEntry.findMany({
    where: entryWhere(ctx.organizationId, f),
    include: { site: { select: { name: true } }, partnerOrganization: { select: { name: true } } },
    orderBy: [{ competence: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

/** Resumo: provisionado (em aberto) × baixado, por sentido. */
export async function entriesSummary(ctx: AuthContext | null) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const rows = await db.financialEntry.groupBy({ by: ["kind", "status"], where: { operatorId: ctx.organizationId, status: { not: "CANCELLED" } }, _sum: { amount: true, paidAmount: true }, _count: true });
  const get = (kind: EntryKind, status: EntryStatus) => rows.find((r) => r.kind === kind && r.status === status);
  return {
    receivableOpen: get("RECEIVABLE", "OPEN")?._sum.amount?.toString() ?? "0",
    receivablePaid: get("RECEIVABLE", "PAID")?._sum.paidAmount?.toString() ?? "0",
    payableOpen: get("PAYABLE", "OPEN")?._sum.amount?.toString() ?? "0",
    payablePaid: get("PAYABLE", "PAID")?._sum.paidAmount?.toString() ?? "0",
    overdue: await db.financialEntry.count({ where: { operatorId: ctx.organizationId, status: "OPEN", dueDate: { lt: new Date() } } }),
  };
}

export async function financeFormOptions(ctx: AuthContext | null) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const [sites, contracts] = await Promise.all([
    db.site.findMany({ where: { operatorId: ctx.organizationId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.contract.findMany({ where: { operatorId: ctx.organizationId }, select: { id: true, number: true, partnerOrganization: { select: { name: true } } }, orderBy: { number: "asc" } }),
  ]);
  return { sites, contracts };
}

// ── Tributos configuráveis ──

export const taxRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    rate: z.coerce.number().gt(0).max(1, "Informe como fração (0,06 = 6%)."),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, { message: "O término deve ser posterior ao início.", path: ["effectiveTo"] });

/** Tributos são versionados por vigência (nova regra; a anterior não é alterada). */
export async function createTaxRule(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:approve");
  requireOperator(ctx);
  const d = taxRuleSchema.parse(raw);
  if (await isPeriodClosed(ctx.organizationId, periodOf(d.effectiveFrom))) throw new AppError("CONFLICT", "A vigência começa em período fechado.");
  const t = await db.taxRule.create({ data: { ...d, rate: d.rate.toFixed(6), operatorId: ctx.organizationId, createdById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.tax_rule_created", entityType: "TaxRule", entityId: t.id, data: { name: d.name, rate: d.rate, effectiveFrom: d.effectiveFrom.toISOString() } });
  return t;
}

/** Encerrar vigência: só para data futura ou em período aberto (não altera período fechado). */
export async function endTaxRule(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:approve");
  requireOperator(ctx);
  const d = z.object({ taxRuleId: z.string(), effectiveTo: z.coerce.date() }).parse(raw);
  const t = await db.taxRule.findFirst({ where: { id: d.taxRuleId, operatorId: ctx.organizationId } });
  if (!t) throw notFound();
  if (t.effectiveTo) throw new AppError("CONFLICT", "Regra já encerrada.");
  if (d.effectiveTo <= t.effectiveFrom) throw new AppError("VALIDATION", "O término deve ser posterior ao início.");
  if (await isPeriodClosed(ctx.organizationId, periodOf(new Date(d.effectiveTo.getTime() - 1)))) throw new AppError("CONFLICT", "O término cairia em período fechado.");
  await db.taxRule.update({ where: { id: t.id }, data: { effectiveTo: d.effectiveTo } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.tax_rule_ended", entityType: "TaxRule", entityId: t.id, data: { effectiveTo: d.effectiveTo.toISOString() } });
}

export async function listTaxRules(ctx: AuthContext | null) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  return db.taxRule.findMany({ where: { operatorId: ctx.organizationId }, orderBy: [{ effectiveFrom: "desc" }] });
}
