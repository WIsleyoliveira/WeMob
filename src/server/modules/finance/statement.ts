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
import { buildXlsx, type ColumnType } from "@/lib/xlsx";
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

/** Coluna exportada: `key` no CSV (estável para integrações), `label` no Excel (leitura humana), `type` só no Excel. */
type ExportColumn = { key: string; label: string; type?: ColumnType };
type ExportTable = { columns: ExportColumn[]; rows: unknown[][] };

const LINE_COLUMNS: ExportColumn[] = [
  { key: "periodo", label: "Período" }, { key: "situacao", label: "Situação" }, { key: "unidade", label: "Unidade" }, { key: "parceiro", label: "Parceiro" },
  { key: "contrato", label: "Contrato" }, { key: "versao", label: "Versão", type: "integer" },
  { key: "receita_recarga", label: "Receita de recarga (R$)", type: "money" }, { key: "outras_receitas", label: "Outras receitas (R$)", type: "money" },
  { key: "bruto", label: "Faturamento bruto (R$)", type: "money" }, { key: "tributos", label: "Tributos (R$)", type: "money" },
  { key: "taxa_sistema", label: "Taxa de sistema — modelo antigo (R$)", type: "money" }, { key: "receita_liquida", label: "Receita líquida (R$)", type: "money" },
  { key: "royalty", label: "Royalty — modelo antigo (R$)", type: "money" }, { key: "custos", label: "Custos da unidade (R$)", type: "money" },
  { key: "resultado_operacional", label: "Resultado operacional (R$)", type: "money" }, { key: "prejuizo_compensado", label: "Prejuízo compensado (R$)", type: "money" },
  { key: "repasse_parceiro", label: "Repasse ao parceiro (R$)", type: "money" }, { key: "resultado_operadora", label: "Resultado da operadora (R$)", type: "money" },
  { key: "modelo", label: "Modelo" }, { key: "participacao_wemob", label: "Participação WeMob (R$)", type: "money" }, { key: "parte_posto", label: "Parte do posto (R$)", type: "money" },
  { key: "tarifas_gateway", label: "Tarifas do gateway (R$)", type: "money" }, { key: "tarifas_sem_responsavel", label: "Tarifas sem responsável (R$)", type: "money" },
];

function statementTable(period: string, situation: string, lines: ClosingResult["lines"]): ExportTable {
  return {
    columns: LINE_COLUMNS,
    rows: lines.map((l) => [period, situation, l.siteName, l.partnerName, l.contract?.contractNumber, l.contract?.version, l.chargingRevenue, l.otherRevenue, l.gross, l.taxTotal, l.platformFee, l.netRevenue, l.royalty, l.expenses, l.operatingResult, l.lossCarriedIn, l.partnerShare, l.operatorResult, l.shareModel === "REVENUE_SHARE" ? "participacao_bruto" : "antigo", l.wemobShare ?? "", l.partnerGrossShare ?? "", l.gatewayFees ?? "", l.gatewayFeesUnallocated ?? ""]),
  };
}

const toCsv = (t: ExportTable) => "\uFEFF" + [t.columns.map((c) => c.key).join(","), ...t.rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
const toXlsx = (sheetName: string, t: ExportTable) => buildXlsx([{ name: sheetName, columns: t.columns.map((c) => ({ header: c.label, type: c.type })), rows: t.rows }]);

export function statementLinesCsv(period: string, situation: string, lines: ClosingResult["lines"]) {
  return toCsv(statementTable(period, situation, lines));
}

export function statementLinesXlsx(period: string, situation: string, lines: ClosingResult["lines"]) {
  return toXlsx(`Demonstrativo ${period}`, statementTable(period, situation, lines));
}

export type ExportFormat = "csv" | "xlsx";

/** Exportação autorizada (finance:export) e auditada. */
export async function exportStatementCsv(ctx: AuthContext | null, period: string) {
  const r = await exportStatement(ctx, period, "csv");
  return { filename: r.filename, content: r.content as string };
}

export async function exportStatement(ctx: AuthContext | null, period: string, format: ExportFormat) {
  requirePermission(ctx, "finance:export");
  const s = await getStatement(ctx, period);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.statement_exported", entityType: "PeriodClosing", entityId: s.closing?.id ?? null, data: { period, kind: s.kind, rows: s.result.lines.length, format } });
  const situation = s.kind === "CLOSED" ? "fechado" : "previa";
  const filename = `demonstrativo-${period}${s.kind === "PREVIEW" ? "-previa" : ""}.${format}`;
  return { filename, content: format === "xlsx" ? statementLinesXlsx(period, situation, s.result.lines) : statementLinesCsv(period, situation, s.result.lines) };
}

const ENTRY_COLUMNS: ExportColumn[] = [
  { key: "id", label: "ID" }, { key: "competencia", label: "Competência" }, { key: "sentido", label: "Sentido" }, { key: "categoria", label: "Categoria" },
  { key: "descricao", label: "Descrição" }, { key: "valor", label: "Valor (R$)", type: "money" }, { key: "situacao", label: "Situação" },
  { key: "vencimento", label: "Vencimento", type: "date" }, { key: "unidade", label: "Unidade" }, { key: "parceiro", label: "Parceiro" },
  { key: "baixa_em", label: "Baixa em", type: "datetime" }, { key: "valor_baixado", label: "Valor baixado (R$)", type: "money" },
  { key: "ajusta_periodo", label: "Ajusta o período" }, { key: "origem", label: "Origem" },
];

export async function exportEntriesCsv(ctx: AuthContext | null, raw: unknown = {}) {
  const r = await exportEntries(ctx, raw, "csv");
  return { filename: r.filename, content: r.content as string };
}

export async function exportEntries(ctx: AuthContext | null, raw: unknown, format: ExportFormat) {
  requirePermission(ctx, "finance:export");
  requireOperator(ctx);
  const f = entryFilterSchema.parse(raw ?? {});
  const rows = await db.financialEntry.findMany({ where: entryWhere(ctx.organizationId, f), include: { site: { select: { name: true } }, partnerOrganization: { select: { name: true } } }, orderBy: [{ competence: "asc" }, { createdAt: "asc" }], take: 20000 });
  const table: ExportTable = {
    columns: ENTRY_COLUMNS,
    rows: rows.map((e) => [e.id, e.competence, KIND_LABEL[e.kind], CATEGORY_LABEL[e.category], e.description, e.amount.toFixed(2), ENTRY_STATUS_LABEL[e.status], e.dueDate, e.site?.name, e.partnerOrganization?.name, e.paidAt, e.paidAmount?.toFixed(2), e.adjustsPeriod, e.source]),
  };
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "finance.entries_exported", entityType: "FinancialEntry", data: { rows: rows.length, filter: f, format } });
  const filename = `lancamentos-${new Date().toISOString().slice(0, 10)}.${format}`;
  return { filename, content: format === "xlsx" ? toXlsx("Lançamentos", table) : toCsv(table) };
}
