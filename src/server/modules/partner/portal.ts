/**
 * Portal do parceiro/investidor: SOMENTE dados da própria organização. Do snapshot do fechamento
 * (que contém a rede inteira) são extraídas apenas as linhas dos contratos do parceiro.
 */
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { forbidden } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { versionEffectiveAt } from "@/domain/finance/contracts";
import { assertPeriod } from "@/domain/finance/period";
import { totals } from "@/domain/finance/settlement";
import type { ClosingResult } from "@/server/modules/finance/closing";
import { repasseStatus, statementLinesCsv } from "@/server/modules/finance/statement";
import { operationalOverview } from "@/server/modules/stations/service";

function requirePartner(ctx: AuthContext | null): asserts ctx is AuthContext {
  requirePermission(ctx, "partner_portal:read");
  if (ctx.orgKind === "OPERATOR") throw forbidden("Portal exclusivo de parceiros e investidores.");
}

export async function partnerContracts(ctx: AuthContext | null) {
  requirePartner(ctx);
  const contracts = await db.contract.findMany({
    where: { partnerOrganizationId: ctx.organizationId, status: { not: "DRAFT" } },
    include: { sites: { include: { site: { select: { name: true, city: true, state: true } } } }, versions: { where: { status: "APPROVED" }, orderBy: { version: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  const docs = await db.attachment.findMany({
    where: { entityType: "Contract", entityId: { in: contracts.map((c) => c.id) }, visibleToPartner: true, deletedAt: null },
    select: { id: true, entityId: true, filename: true, size: true, createdAt: true },
  });
  const now = new Date();
  return contracts.map(({ operatorId: _o, createdById: _c, ...c }) => ({
    ...c,
    versions: c.versions.map(({ createdById: _a, decidedById: _b, ...v }) => v),
    current: versionEffectiveAt(c.versions, now),
    documents: docs.filter((d) => d.entityId === c.id),
  }));
}

/** Extratos: linhas do parceiro nos fechamentos aprovados + repasses (provisionado × pago) e ajustes. */
export async function partnerStatements(ctx: AuthContext | null) {
  requirePartner(ctx);
  const contractIds = (await db.contract.findMany({ where: { partnerOrganizationId: ctx.organizationId }, select: { id: true } })).map((c) => c.id);
  const operatorIds = (await db.contract.findMany({ where: { id: { in: contractIds } }, select: { operatorId: true }, distinct: ["operatorId"] })).map((c) => c.operatorId);
  const closings = await db.periodClosing.findMany({ where: { status: "APPROVED", operatorId: { in: operatorIds } }, orderBy: { period: "desc" }, take: 120 });
  const entries = await db.financialEntry.findMany({
    where: { partnerOrganizationId: ctx.organizationId, source: { in: ["CLOSING", "ADJUSTMENT"] }, status: { not: "CANCELLED" } },
    select: { id: true, kind: true, category: true, status: true, description: true, amount: true, paidAmount: true, paidAt: true, dueDate: true, competence: true, adjustsPeriod: true, closingId: true },
    orderBy: { createdAt: "desc" },
  });
  return closings
    .map((c) => {
      const lines = (c.result as unknown as ClosingResult).lines.filter((l) => l.partnerOrganizationId === ctx.organizationId && l.contract && contractIds.includes(l.contract.contractId));
      const mine = entries.filter((e) => e.closingId === c.id);
      return { closingId: c.id, period: c.period, approvedAt: c.decidedAt, hash: c.resultHash, lines, totals: totals(lines), repasses: mine, ...repasseStatus(mine), adjustments: entries.filter((e) => e.adjustsPeriod === c.period) };
    })
    .filter((s) => s.lines.length > 0)
    .sort((a, b) => b.period.localeCompare(a.period));
}

export async function partnerIndicators(ctx: AuthContext | null) {
  requirePartner(ctx);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400_000);
  return operationalOverview(ctx, { from, to });
}

export async function exportPartnerStatementCsv(ctx: AuthContext | null, period: string) {
  requirePartner(ctx);
  assertPeriod(period);
  const s = (await partnerStatements(ctx)).find((x) => x.period === period);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "partner.statement_exported", entityType: "PeriodClosing", entityId: s?.closingId ?? null, data: { period, rows: s?.lines.length ?? 0 } });
  return { filename: `extrato-${period}.csv`, content: statementLinesCsv(period, "fechado", s?.lines ?? []) };
}

/**
 * Parcelas de split destinadas à PRÓPRIA organização (somente PaymentSplit.organizationId = parceiro).
 * Valores do gateway: totalValue é o informado pelo Asaas; "liquidado" só com status DONE.
 * Pagamentos de sandbox são marcados e nunca somados a valores de produção.
 */
export async function partnerSplits(ctx: AuthContext | null) {
  requirePartner(ctx);
  const rows = await db.paymentSplit.findMany({
    where: { organizationId: ctx.organizationId },
    include: { payment: { select: { createdAt: true, status: true, environment: true, method: true, amountCaptured: true, amountRefunded: true, netValue: true, feeAmount: true, session: { select: { transactionId: true, station: { select: { site: { select: { name: true } } } } } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const sumDone = (env: "PRODUCTION" | "SANDBOX") => rows.filter((r) => r.payment.environment === env && r.status === "DONE").reduce((a, r) => a + Number(r.totalValue ?? 0), 0);
  return { rows, settledProduction: sumDone("PRODUCTION").toFixed(2), settledSandbox: sumDone("SANDBOX").toFixed(2), pending: rows.filter((r) => !["DONE", "CANCELLED", "REFUNDED"].includes(r.status)).length };
}
