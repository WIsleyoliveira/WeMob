/**
 * Fechamento mensal: prévia → validações → solicitação → aprovação por outra pessoa autorizada.
 * Na aprovação o resultado é RECALCULADO e comparado ao hash da prévia: se qualquer dado mudou,
 * o pedido é marcado como superado e uma nova prévia é exigida. O resultado aprovado é imutável;
 * correções posteriores entram como lançamentos de ajuste (ver entries.ts).
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { sha256 } from "@/server/crypto";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { assertPeriod, overlapsPeriod, coversWholePeriod, periodRange, previousPeriod } from "@/domain/finance/period";
import { versionChangesWithin, versionEffectiveAt } from "@/domain/finance/contracts";
import { SETTLEMENT_ENGINE_VERSION, byPartner, canonicalJson, computeSiteLine, totals, type ContractTerms, type SiteInput, type SiteLine } from "@/domain/finance/settlement";
import { OPERATING_CATEGORIES, REVENUE_CATEGORIES } from "./entries";

type Tx = PrismaClient | Prisma.TransactionClient;

export interface ClosingResult {
  period: string;
  engineVersion: string;
  operatorId: string;
  range: { start: string; end: string };
  taxRules: { id: string; name: string; rate: string }[];
  lines: SiteLine[];
  networkExpenses: { entryId: string; category: string; description: string; amount: string }[];
  totals: ReturnType<typeof totals>;
  byPartner: ReturnType<typeof byPartner>;
  /** Origem dos números (para auditoria e para detectar mudança entre prévia e aprovação). */
  sources: { payments: { id: string; net: string; splitDone?: string }[]; entries: { id: string; amount: string; category: string; siteId: string | null }[] };
}

export interface Validations {
  errors: string[];
  warnings: string[];
}

const SETTLED = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

/** Reúne os dados do período e calcula. Não grava nada. */
export async function computeClosing(operatorId: string, period: string, tx: Tx = db, now = new Date()): Promise<{ result: ClosingResult; hash: string; validations: Validations }> {
  assertPeriod(period);
  const { start, end } = periodRange(period);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (end > now) errors.push(`O período ${period} ainda não terminou: é possível ver a prévia, mas não fechar.`);
  const [laterClosed, anyEarlierClosed, prevClosing] = await Promise.all([
    tx.periodClosing.findFirst({ where: { operatorId, status: "APPROVED", period: { gt: period } } }),
    tx.periodClosing.findFirst({ where: { operatorId, status: "APPROVED", period: { lt: period } } }),
    tx.periodClosing.findFirst({ where: { operatorId, status: "APPROVED", period: previousPeriod(period) } }),
  ]);
  if (laterClosed) errors.push(`Já existe período posterior fechado (${laterClosed.period}).`);
  if (anyEarlierClosed && !prevClosing) errors.push(`Feche os períodos em ordem: ${previousPeriod(period)} ainda está aberto.`);

  const [sites, payments, entries, rules, pendingPayments] = await Promise.all([
    tx.site.findMany({
      where: { operatorId, deletedAt: null, isDemo: false },
      include: { partnerOrganization: { select: { id: true, name: true } }, contracts: { include: { contract: { include: { versions: true } } } } },
      orderBy: { name: "asc" },
    }),
    tx.payment.findMany({
      where: { environment: "PRODUCTION", status: { in: [...SETTLED] }, session: { environment: "PRODUCTION", stoppedAt: { gte: start, lt: end }, station: { operatorId } } },
      select: {
        id: true, amountCaptured: true, amountRefunded: true, feeAmount: true, reconciledAt: true,
        session: { select: { stationId: true, station: { select: { siteId: true, ocppIdentity: true } } } },
        refunds: { where: { status: "REQUESTED" }, select: { id: true } },
        splits: { select: { organizationId: true, status: true, totalValue: true } },
      },
      orderBy: { id: "asc" },
    }),
    tx.financialEntry.findMany({ where: { operatorId, competence: period, status: { not: "CANCELLED" }, category: { in: OPERATING_CATEGORIES } }, orderBy: { id: "asc" } }),
    tx.taxRule.findMany({ where: { operatorId }, orderBy: { name: "asc" } }),
    tx.payment.count({ where: { status: { in: ["PENDING", "AUTHORIZED"] }, environment: "PRODUCTION", session: { environment: "PRODUCTION", stoppedAt: { gte: start, lt: end }, station: { operatorId } } } }),
  ]);

  const taxRules = rules.filter((r) => overlapsPeriod({ from: r.effectiveFrom, to: r.effectiveTo }, period));
  for (const r of taxRules) if (!coversWholePeriod({ from: r.effectiveFrom, to: r.effectiveTo }, period)) errors.push(`Tributo "${r.name}" tem vigência parcial no período (rateio por dia não suportado).`);
  if (taxRules.length === 0) warnings.push("Nenhum tributo configurado para o período: valores calculados sem tributos.");
  if (pendingPayments > 0) warnings.push(`${pendingPayments} pagamento(s) de sessões do período ainda não capturado(s): não entram na receita.`);
  const unreconciled = payments.filter((p) => !p.reconciledAt).length;
  if (unreconciled > 0) warnings.push(`${unreconciled} pagamento(s) incluído(s) ainda não conciliado(s) com o provedor.`);
  const refundsInFlight = payments.filter((p) => p.refunds.length).length;
  if (refundsInFlight > 0) warnings.push(`${refundsInFlight} pagamento(s) com estorno em andamento: a receita considera só estornos concluídos.`);
  const splitsOpen = payments.flatMap((p) => p.splits).filter((x) => !["DONE", "CANCELLED", "REFUNDED"].includes(x.status)).length;
  if (splitsOpen > 0) warnings.push(`${splitsOpen} split(s) ainda não liquidado(s): não descontados do repasse deste período.`);

  const prevLines = new Map(((prevClosing?.result as unknown as ClosingResult | undefined)?.lines ?? []).map((l) => [`${l.siteId}:${l.contract?.contractId}`, l]));
  const lines: SiteLine[] = [];
  const networkExpenses: ClosingResult["networkExpenses"] = [];
  for (const e of entries.filter((x) => !x.siteId)) {
    if (REVENUE_CATEGORIES.includes(e.category)) errors.push(`Receita sem unidade ("${e.description}"): informe a unidade para o rateio.`);
    else networkExpenses.push({ entryId: e.id, category: e.category, description: e.description, amount: e.amount.toFixed(2) });
  }
  if (networkExpenses.length) warnings.push(`${networkExpenses.length} despesa(s) sem unidade: entram só no resultado da rede, sem rateio com parceiros.`);

  for (const site of sites) {
    const sitePayments = payments.filter((p) => p.session?.station.siteId === site.id);
    const siteEntries = entries.filter((e) => e.siteId === site.id);
    const link = site.contracts.find((cs) => cs.contract.status !== "DRAFT" && cs.contract.partnerOrganizationId === site.partnerOrganizationId);
    if (!sitePayments.length && !siteEntries.length && !link) continue;

    let contract: ContractTerms | null = null;
    if (site.partnerOrganizationId) {
      const v = link ? versionEffectiveAt(link.contract.versions, start) : null;
      const changes = link ? versionChangesWithin(link.contract.versions, start, end) : [];
      if (!link || !v) {
        errors.push(`Unidade "${site.name}" (parceiro ${site.partnerOrganization?.name}) sem versão de contrato APROVADA vigente no início do período.`);
        continue;
      }
      if (changes.length) {
        errors.push(`Contrato ${link.contract.number}: condição muda dentro do período (versão v${changes[0].version}); rateio por dia não suportado — ajuste a vigência para o início de um mês.`);
        continue;
      }
      if (link.contract.status === "SUSPENDED") warnings.push(`Contrato ${link.contract.number} está suspenso: apurado normalmente; confirme o tratamento antes de aprovar.`);
      contract = {
        contractId: link.contract.id,
        contractNumber: link.contract.number,
        versionId: v.id,
        version: v.version,
        royaltyRate: v.royaltyRate.toString(),
        royaltyBase: v.royaltyBase,
        platformFeeRate: v.platformFeeRate.toString(),
        partnerShareRate: v.partnerShareRate.toString(),
        partnerShareBase: v.partnerShareBase,
        lossTreatment: v.lossTreatment,
        paymentTermDays: v.paymentTermDays,
      };
    }
    const byStation = new Map<string, { stationId: string; identity: string; chargingRevenue: Decimal; paymentCount: number }>();
    for (const p of sitePayments) {
      const s = p.session!;
      const cur = byStation.get(s.stationId) ?? { stationId: s.stationId, identity: s.station.ocppIdentity, chargingRevenue: new Decimal(0), paymentCount: 0 };
      cur.chargingRevenue = cur.chargingRevenue.plus(p.amountCaptured.toString()).minus(p.amountRefunded.toString());
      cur.paymentCount++;
      byStation.set(s.stationId, cur);
    }
    const input: SiteInput = {
      siteId: site.id,
      siteName: site.name,
      partnerOrganizationId: contract ? site.partnerOrganizationId : null,
      partnerName: contract ? site.partnerOrganization?.name ?? null : null,
      contract,
      stations: [...byStation.values()].map((s) => ({ ...s, chargingRevenue: s.chargingRevenue.toFixed(2) })),
      manualRevenue: siteEntries.filter((e) => REVENUE_CATEGORIES.includes(e.category)).map((e) => ({ category: e.category, amount: e.amount.toString() })),
      expenses: siteEntries.filter((e) => !REVENUE_CATEGORIES.includes(e.category)).map((e) => ({ category: e.category, amount: e.amount.toString() })),
      lossCarriedIn: contract ? prevLines.get(`${site.id}:${contract.contractId}`)?.lossCarriedOut ?? "0" : "0",
      splitAlreadyTransferred: contract
        ? sitePayments.flatMap((p) => p.splits).filter((x) => x.status === "DONE" && x.organizationId === site.partnerOrganizationId).reduce((a, x) => a.plus(x.totalValue?.toString() ?? 0), new Decimal(0)).toFixed(2)
        : "0",
      gatewayFees: sitePayments.reduce((a, p) => a.plus(p.feeAmount?.toString() ?? 0), new Decimal(0)).toFixed(2),
    };
    lines.push(computeSiteLine(input, taxRules.map((r) => ({ name: r.name, rate: r.rate.toString() }))));
  }

  const netExpensesTotal = networkExpenses.reduce((a, x) => a.plus(x.amount), new Decimal(0)).toFixed(2);
  const result: ClosingResult = {
    period,
    engineVersion: SETTLEMENT_ENGINE_VERSION,
    operatorId,
    range: { start: start.toISOString(), end: end.toISOString() },
    taxRules: taxRules.map((r) => ({ id: r.id, name: r.name, rate: r.rate.toString() })),
    lines,
    networkExpenses,
    totals: totals(lines, netExpensesTotal),
    byPartner: byPartner(lines),
    sources: {
      payments: payments.map((p) => ({ id: p.id, net: new Decimal(p.amountCaptured.toString()).minus(p.amountRefunded.toString()).toFixed(2), splitDone: p.splits.filter((x) => x.status === "DONE").reduce((a, x) => a.plus(x.totalValue?.toString() ?? 0), new Decimal(0)).toFixed(2) })),
      entries: entries.map((e) => ({ id: e.id, amount: e.amount.toFixed(2), category: e.category, siteId: e.siteId })),
    },
  };
  return { result, hash: sha256(canonicalJson(result)), validations: { errors, warnings } };
}

export async function previewClosing(ctx: AuthContext | null, period: string) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const [computed, approved, pending] = await Promise.all([
    computeClosing(ctx.organizationId, period),
    db.periodClosing.findFirst({ where: { operatorId: ctx.organizationId, period, status: "APPROVED" } }),
    db.periodClosing.findFirst({ where: { operatorId: ctx.organizationId, period, status: "PENDING_APPROVAL" } }),
  ]);
  return { ...computed, approved, pending };
}

export async function requestClosing(ctx: AuthContext | null, period: string) {
  requirePermission(ctx, "finance:close");
  requireOperator(ctx);
  const { result, hash, validations } = await computeClosing(ctx.organizationId, period);
  if (validations.errors.length) throw new AppError("VALIDATION", `Fechamento bloqueado: ${validations.errors.join(" ")}`);
  try {
    const c = await db.periodClosing.create({
      data: { operatorId: ctx.organizationId, period, result: result as unknown as Prisma.InputJsonValue, resultHash: hash, engineVersion: SETTLEMENT_ENGINE_VERSION, validations: validations as unknown as Prisma.InputJsonValue, requestedById: ctx.userId },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.closing_requested", entityType: "PeriodClosing", entityId: c.id, data: { period, hash, totals: result.totals } });
    return c;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", "Já existe fechamento pendente ou aprovado para este período.");
    throw e;
  }
}

/** Aprovação: outra pessoa, recálculo idêntico ao da prévia, registro imutável e repasses provisionados. */
export async function approveClosing(ctx: AuthContext | null, closingId: string, note?: string) {
  requirePermission(ctx, "finance:approve");
  requireOperator(ctx);
  const c = await db.periodClosing.findFirst({ where: { id: closingId, operatorId: ctx.organizationId } });
  if (!c) throw notFound("Fechamento não encontrado.");
  if (c.status !== "PENDING_APPROVAL") throw new AppError("CONFLICT", "Este fechamento não está aguardando aprovação.");
  if (c.requestedById === ctx.userId) throw new AppError("FORBIDDEN", "A aprovação deve ser feita por pessoa diferente de quem solicitou o fechamento.");
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`period:${ctx.organizationId}:${c.period}`}))`;
    const { result, hash, validations } = await computeClosing(ctx.organizationId, c.period, tx);
    if (hash !== c.resultHash || validations.errors.length) {
      await tx.periodClosing.update({ where: { id: c.id }, data: { status: "SUPERSEDED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: "Dados alterados após a prévia: recalcular." } });
      await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.closing_superseded", entityType: "PeriodClosing", entityId: c.id, data: { previewHash: c.resultHash, currentHash: hash } }, tx);
      return "superseded" as const;
    }
    const r = await tx.periodClosing.updateMany({ where: { id: c.id, status: "PENDING_APPROVAL" }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    if (r.count !== 1) throw new AppError("CONFLICT", "O fechamento já foi decidido por outra pessoa.");
    const { end } = periodRange(c.period);
    for (const l of result.lines) {
      if (!l.contract || !l.partnerOrganizationId) continue;
      // Saldo = repasse contratual − o que já foi transferido via split no gateway (snapshots antigos: repasse integral).
      const share = new Decimal(l.partnerBalance ?? l.partnerShare);
      if (share.isZero()) continue;
      await tx.financialEntry.create({
        data: {
          operatorId: ctx.organizationId,
          kind: share.gt(0) ? "PAYABLE" : "RECEIVABLE",
          category: share.gt(0) ? "PARTNER_SHARE" : "PARTNER_CONTRIBUTION",
          source: "CLOSING",
          description: `${share.gt(0) ? "Repasse" : "Aporte do parceiro"} ${c.period} — ${l.siteName} (${l.contract.contractNumber} v${l.contract.version})${new Decimal(l.partnerSplitReceived ?? 0).gt(0) ? ` · descontado split já recebido R$ ${l.partnerSplitReceived}` : ""}`,
          amount: share.abs().toFixed(2),
          competence: c.period,
          dueDate: new Date(end.getTime() + l.contract.paymentTermDays * 86400_000),
          siteId: l.siteId,
          partnerOrganizationId: l.partnerOrganizationId,
          contractId: l.contract.contractId,
          closingId: c.id,
          createdById: ctx.userId,
        },
      });
    }
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.closing_approved", entityType: "PeriodClosing", entityId: c.id, data: { period: c.period, hash, note } }, tx);
    return "approved" as const;
  });
  if (outcome === "superseded") throw new AppError("CONFLICT", "Os dados do período mudaram depois da prévia. O pedido foi marcado como superado: gere nova prévia e solicite novamente.");
}

export async function rejectClosing(ctx: AuthContext | null, closingId: string, raw: unknown) {
  requirePermission(ctx, "finance:approve");
  requireOperator(ctx);
  const { note } = z.object({ note: z.string().trim().min(5, "Informe o motivo da recusa.").max(500) }).parse(raw);
  const r = await db.periodClosing.updateMany({ where: { id: closingId, operatorId: ctx.organizationId, status: "PENDING_APPROVAL" }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
  if (r.count !== 1) throw new AppError("CONFLICT", "Fechamento inexistente ou já decidido.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.closing_rejected", entityType: "PeriodClosing", entityId: closingId, data: { note } });
}

export async function listClosings(ctx: AuthContext | null) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  return db.periodClosing.findMany({
    where: { operatorId: ctx.organizationId },
    select: { id: true, period: true, status: true, resultHash: true, requestedById: true, requestedAt: true, decidedById: true, decidedAt: true, decisionNote: true },
    orderBy: [{ period: "desc" }, { requestedAt: "desc" }],
  });
}

export async function getClosing(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  const c = await db.periodClosing.findFirst({ where: { id, operatorId: ctx.organizationId }, include: { entries: { orderBy: { createdAt: "asc" } } } });
  if (!c) throw notFound("Fechamento não encontrado.");
  const [adjustments, users] = await Promise.all([
    db.financialEntry.findMany({ where: { operatorId: ctx.organizationId, adjustsPeriod: c.period, status: { not: "CANCELLED" } }, include: { partnerOrganization: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({ where: { id: { in: [c.requestedById, c.decidedById].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  return {
    ...c,
    result: c.result as unknown as ClosingResult,
    validations: c.validations as unknown as Validations,
    hashValid: sha256(canonicalJson(c.result)) === c.resultHash,
    adjustments,
    userNames: Object.fromEntries(users.map((u) => [u.id, u.name])),
  };
}
