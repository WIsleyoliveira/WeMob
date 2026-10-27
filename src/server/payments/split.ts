/**
 * Split de pagamentos: recebedores (carteiras Asaas dos parceiros) e políticas versionadas.
 * - Recebedor: walletId informado pelo parceiro e VALIDADO por pessoa diferente de quem cadastrou (a API do
 *   Asaas só expõe o walletId da própria conta, então a conferência é documental). Nunca gerar walletId.
 * - Política: participantes com % (sobre o netValue) e/ou valor fixo; aprovação por outra pessoa; imutável.
 * - Na cobrança, a política vigente é COPIADA (PaymentSplit + versão no pagamento): mudanças posteriores
 *   não afetam cobranças já criadas.
 * Sem ASAAS_SPLIT_ENABLED=1, política aprovada e recebedor ativo, a cobrança sai sem split e o repasse é
 * conciliado manualmente no fechamento mensal (P08).
 */
import { z } from "zod";
import type { PaymentEnvironment, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { validateForCharge, validatePolicy } from "@/domain/payments/split";
import type { SplitInstruction } from "./provider";

const WALLET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createRecipient(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:recipients_manage");
  requireOperator(ctx);
  const d = z.object({
    organizationId: z.string().min(1),
    environment: z.enum(["SANDBOX", "PRODUCTION"]),
    walletId: z.string().trim().regex(WALLET_RE, "walletId deve ser o identificador (UUID) da carteira Asaas do parceiro."),
    note: z.string().trim().min(5, "Registre a origem do walletId (ex.: e-mail do parceiro, comprovante).").max(500),
  }).parse(raw);
  const org = await db.organization.findFirst({ where: { id: d.organizationId, kind: { in: ["PARTNER", "INVESTOR"] }, deletedAt: null } });
  if (!org) throw notFound("Parceiro não encontrado.");
  if (!(await db.site.findFirst({ where: { operatorId: ctx.organizationId, partnerOrganizationId: org.id, deletedAt: null } }))) throw new AppError("VALIDATION", "Parceiro sem unidade vinculada a esta operadora.");
  const own = process.env.ASAAS_OWN_WALLET_ID?.trim();
  if (own && own.toLowerCase() === d.walletId.toLowerCase()) throw new AppError("VALIDATION", "Este é o walletId da própria conta WeMob: não pode ser recebedor do split.");
  if (await db.paymentRecipient.findFirst({ where: { operatorId: ctx.organizationId, organizationId: org.id, environment: d.environment, status: { not: "DISABLED" } } }))
    throw new AppError("CONFLICT", "Parceiro já possui recebedor neste ambiente. Desative-o antes de cadastrar outro.");
  try {
    const r = await db.paymentRecipient.create({ data: { ...d, walletId: d.walletId.toLowerCase(), operatorId: ctx.organizationId, createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.recipient_created", entityType: "PaymentRecipient", entityId: r.id, data: { organizationId: org.id, environment: d.environment } });
    return r;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new AppError("CONFLICT", "walletId já cadastrado para outro recebedor.");
    throw e;
  }
}

export async function validateRecipient(ctx: AuthContext | null, recipientId: string) {
  requirePermission(ctx, "payment:recipients_manage");
  requireOperator(ctx);
  const r = await db.paymentRecipient.findFirst({ where: { id: recipientId, operatorId: ctx.organizationId } });
  if (!r) throw notFound();
  if (r.createdById === ctx.userId) throw new AppError("FORBIDDEN", "A validação deve ser feita por pessoa diferente de quem cadastrou.");
  const u = await db.paymentRecipient.updateMany({ where: { id: r.id, status: "PENDING_VALIDATION" }, data: { status: "ACTIVE", validatedById: ctx.userId, validatedAt: new Date() } });
  if (u.count !== 1) throw new AppError("CONFLICT", "Recebedor não está aguardando validação.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.recipient_validated", entityType: "PaymentRecipient", entityId: r.id });
}

export async function disableRecipient(ctx: AuthContext | null, recipientId: string) {
  requirePermission(ctx, "payment:recipients_manage");
  requireOperator(ctx);
  const u = await db.paymentRecipient.updateMany({ where: { id: recipientId, operatorId: ctx.organizationId, status: { not: "DISABLED" } }, data: { status: "DISABLED", disabledAt: new Date() } });
  if (u.count !== 1) throw notFound();
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.recipient_disabled", entityType: "PaymentRecipient", entityId: recipientId });
}

const participantSchema = z.object({
  kind: z.enum(["SITE_PARTNER", "RECIPIENT"]),
  recipientId: z.string().optional().transform((v) => v || undefined),
  percentualValue: z.coerce.number().optional(),
  fixedValue: z.coerce.number().optional(),
  description: z.string().trim().max(120).optional(),
});

export async function createSplitPolicy(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:split_configure");
  requireOperator(ctx);
  const d = z.object({
    siteId: z.string().optional().transform((v) => v || undefined),
    effectiveFrom: z.coerce.date(),
    feeTreatment: z.string().trim().min(10, "Descreva como as tarifas do gateway são tratadas.").max(1000),
    reason: z.string().trim().min(5).max(500),
    participants: z.array(participantSchema).min(1).max(10),
  }).parse(raw);
  if (d.siteId && !(await db.site.findFirst({ where: { id: d.siteId, operatorId: ctx.organizationId, deletedAt: null } }))) throw notFound("Unidade não encontrada.");
  for (const p of d.participants) {
    if (p.kind === "RECIPIENT" && !(p.recipientId && (await db.paymentRecipient.findFirst({ where: { id: p.recipientId, operatorId: ctx.organizationId } }))))
      throw new AppError("VALIDATION", "Participante fixo exige recebedor desta operadora.");
  }
  const errors = validatePolicy(d.participants.map((p, i) => ({ label: `Participante ${i + 1}`, percentualValue: p.percentualValue, fixedValue: p.fixedValue })));
  if (errors.length) throw new AppError("VALIDATION", errors.join(" "));
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`splitpolicy:${ctx.organizationId}:${d.siteId ?? "*"}`}))`;
    const last = await tx.splitPolicy.findFirst({ where: { operatorId: ctx.organizationId, siteId: d.siteId ?? null }, orderBy: { version: "desc" } });
    if (last?.status === "DRAFT") throw new AppError("CONFLICT", "Já existe versão em rascunho aguardando decisão.");
    const policy = await tx.splitPolicy.create({
      data: {
        operatorId: ctx.organizationId, siteId: d.siteId ?? null, version: (last?.version ?? 0) + 1, effectiveFrom: d.effectiveFrom, feeTreatment: d.feeTreatment, reason: d.reason, createdById: ctx.userId,
        participants: { create: d.participants.map((p) => ({ kind: p.kind, recipientId: p.recipientId, percentualValue: p.percentualValue, fixedValue: p.fixedValue, description: p.description })) },
      },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.split_policy_created", entityType: "SplitPolicy", entityId: policy.id, data: { version: policy.version, siteId: d.siteId ?? null } }, tx);
    return policy;
  });
}

export async function decideSplitPolicy(ctx: AuthContext | null, policyId: string, raw: unknown) {
  requirePermission(ctx, "payment:split_configure");
  requireOperator(ctx);
  const d = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(raw);
  const p = await db.splitPolicy.findFirst({ where: { id: policyId, operatorId: ctx.organizationId } });
  if (!p) throw notFound();
  if (p.createdById === ctx.userId) throw new AppError("FORBIDDEN", "A decisão deve ser de pessoa diferente de quem criou a política.");
  if (!d.approve && !d.note) throw new AppError("VALIDATION", "Informe o motivo da recusa.");
  const u = await db.splitPolicy.updateMany({ where: { id: p.id, status: "DRAFT" }, data: { status: d.approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note } });
  if (u.count !== 1) throw new AppError("CONFLICT", "Política já decidida.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: d.approve ? "payment.split_policy_approved" : "payment.split_policy_rejected", entityType: "SplitPolicy", entityId: p.id, data: { version: p.version } });
}

/** Política vigente: aprovada, específica da unidade (se houver) ou padrão; maior effectiveFrom ≤ agora. */
async function effectivePolicy(operatorId: string, siteId: string, at: Date) {
  const where = (s: string | null): Prisma.SplitPolicyWhereInput => ({ operatorId, siteId: s, status: "APPROVED", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] });
  const include = { participants: { include: { recipient: true } } } as const;
  return (
    (await db.splitPolicy.findFirst({ where: where(siteId), include, orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }] })) ??
    (await db.splitPolicy.findFirst({ where: where(null), include, orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }] }))
  );
}

export type SplitResolution =
  | { enabled: true; policyId: string; policyVersion: number; instructions: (SplitInstruction & { organizationId: string; recipientId: string; percentualValue?: string; fixedValue?: string })[] }
  | { enabled: false; reason: string };

/** Resolve o split de uma cobrança. Qualquer impedimento → sem split (com motivo registrado), nunca split inválido. */
export async function resolveSplitForCharge(input: { operatorId: string; siteId: string; environment: PaymentEnvironment; value: string; chargeKey: string; splitEnabled: boolean; at?: Date }): Promise<SplitResolution> {
  if (!input.splitEnabled) return { enabled: false, reason: "Split desabilitado (ASAAS_SPLIT_ENABLED≠1)." };
  const policy = await effectivePolicy(input.operatorId, input.siteId, input.at ?? new Date());
  if (!policy) return { enabled: false, reason: "Sem política de split aprovada e vigente." };
  const site = await db.site.findUniqueOrThrow({ where: { id: input.siteId } });
  const instructions: Extract<SplitResolution, { enabled: true }>["instructions"] = [];
  for (const [i, p] of policy.participants.entries()) {
    const recipient =
      p.kind === "SITE_PARTNER"
        ? site.partnerOrganizationId ? await db.paymentRecipient.findFirst({ where: { operatorId: input.operatorId, organizationId: site.partnerOrganizationId, environment: input.environment, status: "ACTIVE" } }) : null
        : p.recipient && p.recipient.status === "ACTIVE" && p.recipient.environment === input.environment ? p.recipient : null;
    if (!recipient) return { enabled: false, reason: `Participante ${i + 1} sem recebedor ativo no ambiente ${input.environment}.` };
    instructions.push({
      walletId: recipient.walletId, organizationId: recipient.organizationId, recipientId: recipient.id,
      percentualValue: p.percentualValue?.toString(), fixedValue: p.fixedValue?.toString(),
      externalReference: `${input.chargeKey}:split:${i + 1}`, description: p.description ?? undefined,
    });
  }
  const errors = validateForCharge(input.value, instructions.map((x, i) => ({ label: `Participante ${i + 1}`, percentualValue: x.percentualValue, fixedValue: x.fixedValue })));
  if (errors.length) return { enabled: false, reason: errors.join(" ") };
  return { enabled: true, policyId: policy.id, policyVersion: policy.version, instructions };
}

export async function listSplitConfig(ctx: AuthContext | null) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  const [recipients, policies, orgs] = await Promise.all([
    db.paymentRecipient.findMany({ where: { operatorId: ctx.organizationId }, orderBy: { createdAt: "desc" } }),
    db.splitPolicy.findMany({ where: { operatorId: ctx.organizationId }, include: { participants: true }, orderBy: [{ siteId: "asc" }, { version: "desc" }] }),
    db.organization.findMany({ where: { kind: { in: ["PARTNER", "INVESTOR"] }, sitesAsPartner: { some: { operatorId: ctx.organizationId, deletedAt: null } } }, select: { id: true, name: true } }),
  ]);
  const sites = await db.site.findMany({ where: { operatorId: ctx.organizationId, deletedAt: null }, select: { id: true, name: true } });
  return { recipients, policies, orgs, sites };
}

/** Atualiza os splits locais a partir do estado informado pelo gateway (fonte de verdade). */
export async function syncSplitsFromProvider(paymentId: string, remote: { remoteId?: string | null; walletId: string; status: string; totalValue?: string | null; externalReference?: string | null; cancellationReason?: string | null }[]) {
  const local = await db.paymentSplit.findMany({ where: { paymentId } });
  const changes: { id: string; from: string; to: string }[] = [];
  for (const l of local) {
    const r = remote.find((x) => (x.externalReference && x.externalReference === l.externalReference) || x.walletId.toLowerCase() === l.walletId.toLowerCase());
    if (!r) continue;
    if (r.status !== l.status || (r.totalValue ?? null) !== (l.totalValue?.toFixed(2) ?? null) || (r.remoteId ?? null) !== l.remoteId) {
      await db.paymentSplit.update({ where: { id: l.id }, data: { status: r.status, totalValue: r.totalValue ?? undefined, remoteId: r.remoteId ?? undefined, cancellationReason: r.cancellationReason ?? null, doneAt: r.status === "DONE" ? l.doneAt ?? new Date() : l.doneAt } });
      changes.push({ id: l.id, from: l.status, to: r.status });
    }
  }
  return changes;
}
