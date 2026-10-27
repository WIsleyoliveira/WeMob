import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { LEAD_SOURCES, leadFilterSchema, leadWhere } from "@/server/modules/leads/service";

/** Neutraliza injeção de fórmulas em planilhas (CSV injection) e escapa aspas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Exportação autorizada (permissão lead:export) e auditada, com os mesmos filtros da lista. */
export async function exportLeadsCsv(ctx: AuthContext | null, rawFilter: unknown = {}) {
  requirePermission(ctx, "lead:export");
  const f = leadFilterSchema.parse(rawFilter);
  const leads = await db.lead.findMany({
    where: leadWhere(ctx.organizationId, f),
    include: { stage: true, assignee: { select: { name: true } }, company: { select: { name: true, document: true } } },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
  const header = ["id", "criado_em", "contato", "email", "telefone", "empresa", "documento", "cidade", "uf", "origem", "etapa", "prioridade", "valor_estimado", "previsao_fechamento", "responsavel"];
  const lines = leads.map((l) =>
    [l.id, l.createdAt, l.contactName, l.email, l.phone, l.company?.name ?? l.companyName, l.company?.document, l.city, l.state, LEAD_SOURCES[l.source], l.stage.name, l.priority, l.estimatedValue?.toString(), l.expectedCloseDate, l.assignee?.name]
      .map(csvCell)
      .join(","),
  );
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.exported", entityType: "Lead", data: { rows: leads.length, filter: f } });
  return { filename: `leads-${new Date().toISOString().slice(0, 10)}.csv`, content: "﻿" + [header.join(","), ...lines].join("\r\n"), rows: leads.length };
}
