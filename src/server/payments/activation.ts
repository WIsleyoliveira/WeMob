/**
 * Habilitação de pagamentos REAIS (Etapa E da homologação). Produção só opera quando:
 *  1) PAYMENT_PROVIDER=asaas, ASAAS_ENVIRONMENT=production, chave de produção e ASAAS_PRODUCTION_ENABLED=1; e
 *  2) existe habilitação APROVADA para a operadora, solicitada por uma pessoa e aprovada por OUTRA com
 *     payment:enable_production (somente superadministrador), cobrindo tarifas, split, estornos, monitoramento e suporte.
 * Revogação é imediata.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { activeProvider, providerConfigIssues } from "./registry";

export const ACTIVATION_ITEMS = {
  sandboxHomologated: "Fluxos homologados no sandbox oficial (cliente, Pix, webhook, estorno, conciliação)",
  commercialEligibility: "Elegibilidade do modelo de recarga confirmada com o Asaas",
  feesConfirmed: "Tarifas por método de pagamento confirmadas",
  splitConfirmed: "Split: disponibilidade, recebedores e política aprovados (ou split desabilitado)",
  refundPolicy: "Política de cobrança, ajuste e estorno aprovada",
  monitoring: "Monitoramento, alertas e suporte em operação",
  infrastructure: "HTTPS, segredos em cofre, webhook público, backup testado e rollback",
} as const;

const checklistSchema = z.object(Object.fromEntries(Object.keys(ACTIVATION_ITEMS).map((k) => [k, z.literal(true, { errorMap: () => ({ message: `Confirme: ${ACTIVATION_ITEMS[k as keyof typeof ACTIVATION_ITEMS]}` }) })])) as Record<keyof typeof ACTIVATION_ITEMS, z.ZodLiteral<true>>);

export async function productionReadiness(operatorId: string) {
  const reasons: string[] = [...providerConfigIssues()];
  const p = activeProvider();
  if (p.status !== "configured") reasons.push("Nenhum gateway configurado.");
  else if (p.environment !== "PRODUCTION") reasons.push(`Gateway em ambiente ${p.environment === "SANDBOX" ? "sandbox" : p.environment}: produção desabilitada.`);
  const act = await db.gatewayActivation.findFirst({ where: { provider: p.name, operatorId, status: "APPROVED", revokedAt: null } });
  if (!act) reasons.push("Sem habilitação de produção aprovada na plataforma.");
  return { allowed: reasons.length === 0, reasons, activationId: act?.id ?? null };
}

export async function requestActivation(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:reconcile");
  requireOperator(ctx);
  const d = z.object({ checklist: checklistSchema, note: z.string().trim().min(10, "Descreva as evidências (ids de teste, contratos, contatos).").max(2000) }).parse(raw);
  if (await db.gatewayActivation.findFirst({ where: { provider: "asaas", operatorId: ctx.organizationId, status: { in: ["PENDING", "APPROVED"] }, revokedAt: null } }))
    throw new AppError("CONFLICT", "Já existe solicitação pendente ou habilitação ativa.");
  const a = await db.gatewayActivation.create({ data: { provider: "asaas", operatorId: ctx.organizationId, checklist: { ...d.checklist, note: d.note }, requestedById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.production_activation_requested", entityType: "GatewayActivation", entityId: a.id });
  return a;
}

export async function decideActivation(ctx: AuthContext | null, id: string, raw: unknown) {
  requirePermission(ctx, "payment:enable_production");
  requireOperator(ctx);
  const d = z.object({ approve: z.boolean(), note: z.string().trim().min(5, "Informe a justificativa.").max(1000) }).parse(raw);
  const a = await db.gatewayActivation.findFirst({ where: { id, operatorId: ctx.organizationId } });
  if (!a) throw notFound();
  if (a.requestedById === ctx.userId) throw new AppError("FORBIDDEN", "A decisão deve ser de pessoa diferente de quem solicitou.");
  const r = await db.gatewayActivation.updateMany({ where: { id, status: "PENDING" }, data: { status: d.approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note } });
  if (r.count !== 1) throw new AppError("CONFLICT", "Solicitação já decidida.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: d.approve ? "payment.production_activation_approved" : "payment.production_activation_rejected", entityType: "GatewayActivation", entityId: id, data: { note: d.note } });
}

export async function revokeActivation(ctx: AuthContext | null, id: string, reason: string) {
  requirePermission(ctx, "payment:enable_production");
  requireOperator(ctx);
  if (!reason || reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo da revogação.");
  const r = await db.gatewayActivation.updateMany({ where: { id, operatorId: ctx.organizationId, status: "APPROVED", revokedAt: null }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: ctx.userId, decisionNote: reason.trim() } });
  if (r.count !== 1) throw notFound();
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.production_activation_revoked", entityType: "GatewayActivation", entityId: id, data: { reason } });
}

export async function listActivations(ctx: AuthContext | null) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  return db.gatewayActivation.findMany({ where: { operatorId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
}
