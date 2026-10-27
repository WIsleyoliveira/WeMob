/**
 * Demonstrativo por rede, parceiro, unidade e estação. Período fechado → snapshot aprovado
 * (imutável) + ajustes posteriores listados à parte; período aberto → prévia identificada.
 * Provisionado × pago vem dos lançamentos de repasse gerados no fechamento.
 */
import Decimal from "decimal.js";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { assertPeriod } from "@/domain/finance/period";
import { csvCell } from "@/server/modules/crm/export";
import { computeClosing, type ClosingResult } from "./closing";
import { entryFilterSchema, entryWhere, CATEGORY_LABEL, ENTRY_STATUS_LABEL, KIND_LABEL } from "./entries";

export function repasseStatus(entries: { kind: string; category: string; status: string; amount: { toString(): string }; paidAmount: { toString(): string } | null }[]) {
  let provisioned = new Decimal(0);
  let paid = new Decimal(0);
  for (const e of entries) {
    if (e.status === "CANCELLED") continue;
    const sign = e.kind === "PAYABLE" ? 1 : -1;
    if (e.status === "PAID") paid = paid.plus(new Decimal(e.paidAmount?.toString() ?? e.amount.toString()).times(sign));
    else provisioned = provisioned.plus(new Decimal(e.amount.toString()).times(sign));
  }
  return { provisioned: provisioned.toFixed(2), paid: paid.toFixed(2) };
}

export async function getStatement(ctx: AuthContext | null, period: string) {
  requirePermission(ctx, "finance:read");
  requireOperator(ctx);
  assertPeriod(period);
  const closing = await db.periodClosing.findFirst({ where: { operatorId: ctx.organizationId, period, status: "APPROVED" } });
  let result: ClosingResult;
  let validations = null;
  if (closing) result = closing.result as unknown as ClosingResult;
  else {
    const c = await computeClosing(ctx.organizationId, period);
    result = c.result;
    validations = c.validations;
  }
  const [repasses, adjustments] = await Promise.all([
    closing ? db.financialEntry.findMany({ where: { closingId: closing.id }, include: { partnerOrganization: { select: { name: true } } } }) : Promise.resolve([]),
    db.financialEntry.findMany({ where: { operatorId: ctx.organizationId, adjustsPeriod: period, status: { not: "CANCELLED" } }, include: { partnerOrganization: { select: { name: true } } } }),
  ]);
  const partnerPayment = Object.fromEntries(
    result.byPartner.map((p) => [p.partnerOrganizationId, repasseStatus(repasses.filter((e) => e.partnerOrganizationId === p.partnerOrganizationId))]),
  );
  return { kind: closing ? ("CLOSED" as const) : ("PREVIEW" as const), closing, result, validations, repasses, adjustments, partnerPayment };
}

const LINE_HEADER = ["periodo", "situacao", "unidade", "parceiro", "contrato", "versao", "receita_recarga", "outras_receitas", "bruto", "tributos", "taxa_sistema", "receita_liquida", "royalty", "custos", "resultado_operacional", "prejuizo_compensado", "repasse_parceiro", "resultado_operadora"];

export function statementLinesCsv(period: string, situation: string, lines: ClosingResult["lines"]) {
  const rows = lines.map((l) =>
    [period, situation, l.siteName, l.partnerName, l.contract?.contractNumber, l.contract?.version, l.chargingRevenue, l.otherRevenue, l.gross, l.taxTotal, l.platformFee, l.netRevenue, l.royalty, l.expenses, l.operatingResult, l.lossCarriedIn, l.partnerShare, l.operatorResult]
      .map(csvCell)
      .join(","),
  );
  return "﻿" + [LINE_HEADER.join(","), ...rows].join("\r\n");
}

/** Exportação autorizada (finance:export) e auditada. */
export async function exportStatementCsv(ctx: AuthContext | null, period: string) {
  requirePermission(ctx, "finance:export");
  const s = await getStatement(ctx, period);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.statement_exported", entityType: "PeriodClosing", entityId: s.closing?.id ?? null, data: { period, kind: s.kind, rows: s.result.lines.length } });
  return { filename: `demonstrativo-${period}${s.kind === "PREVIEW" ? "-previa" : ""}.csv`, content: statementLinesCsv(period, s.kind === "CLOSED" ? "fechado" : "previa", s.result.lines) };
}

export async function exportEntriesCsv(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "finance:export");
  requireOperator(ctx);
  const f = entryFilterSchema.parse(raw);
  const rows = await db.financialEntry.findMany({ where: entryWhere(ctx.organizationId, f), include: { site: { select: { name: true } }, partnerOrganization: { select: { name: true } } }, orderBy: [{ competence: "asc" }, { createdAt: "asc" }], take: 20000 });
  const header = ["id", "competencia", "sentido", "categoria", "descricao", "valor", "situacao", "vencimento", "unidade", "parceiro", "baixa_em", "valor_baixado", "ajusta_periodo", "origem"];
  const lines = rows.map((e) =>
    [e.id, e.competence, KIND_LABEL[e.kind], CATEGORY_LABEL[e.category], e.description, e.amount.toFixed(2), ENTRY_STATUS_LABEL[e.status], e.dueDate, e.site?.name, e.partnerOrganization?.name, e.paidAt, e.paidAmount?.toFixed(2), e.adjustsPeriod, e.source].map(csvCell).join(","),
  );
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.entries_exported", entityType: "FinancialEntry", data: { rows: rows.length, filter: f } });
  return { filename: `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`, content: "﻿" + [header.join(","), ...lines].join("\r\n") };
}
