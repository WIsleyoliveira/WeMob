/**
 * Contratos com parceiros/investidores. Condições comerciais vivem em versões IMUTÁVEIS
 * (original + aditivos), aprovadas por pessoa diferente de quem criou. Versões anteriores
 * nunca são editadas; autor, data e motivo ficam na própria versão e na auditoria.
 */
import { z } from "zod";
import type { ContractStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequence";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { versionEffectiveAt } from "@/domain/finance/contracts";
import { periodOf } from "@/domain/finance/period";
import { isPeriodClosed } from "@/server/modules/finance/periods";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { DRAFT: "Rascunho", ACTIVE: "Ativo", SUSPENDED: "Suspenso", TERMINATED: "Encerrado" };
export const BASE_LABEL = { GROSS_REVENUE: "Receita bruta", NET_REVENUE: "Receita líquida", OPERATING_RESULT: "Resultado operacional" } as const;
export const LOSS_LABEL = { SHARE_MONTHLY: "Prejuízo rateado no mês (parceiro aporta)", CARRY_FORWARD: "Prejuízo compensado nos meses seguintes" } as const;

const rate = z.coerce.number().min(0, "Mínimo 0").max(1, "Informe como fração entre 0 e 1");

export const versionTermsSchema = z
  .object({
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    commercialModelVersionId: z.string().optional().transform((v) => v || undefined),
    royaltyRate: rate,
    royaltyBase: z.enum(["GROSS_REVENUE", "NET_REVENUE"]),
    platformFeeRate: rate,
    partnerShareRate: rate,
    partnerShareBase: z.enum(["GROSS_REVENUE", "NET_REVENUE", "OPERATING_RESULT"]),
    lossTreatment: z.enum(["SHARE_MONTHLY", "CARRY_FORWARD"]).default("SHARE_MONTHLY"),
    paymentTermDays: z.coerce.number().int().min(0).max(120).default(10),
    conditions: z.string().trim().min(5, "Descreva as condições.").max(5000),
    reason: z.string().trim().min(5, "Informe o motivo.").max(500),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, { message: "O término deve ser posterior ao início.", path: ["effectiveTo"] })
  .refine((v) => !(v.lossTreatment === "CARRY_FORWARD" && v.partnerShareBase !== "OPERATING_RESULT"), {
    message: "Compensação de prejuízo só se aplica com base no resultado operacional.",
    path: ["lossTreatment"],
  });

export const contractSchema = z.object({
  partnerOrganizationId: z.string().min(1, "Selecione o parceiro."),
  title: z.string().trim().min(3).max(160),
  siteIds: z.array(z.string()).min(1, "Selecione ao menos uma unidade.").max(50),
});

async function validateModelVersion(ctx: AuthContext, id?: string) {
  if (!id) return;
  const mv = await db.commercialModelVersion.findFirst({ where: { id, status: "APPROVED", model: { organizationId: ctx.organizationId } } });
  if (!mv) throw new AppError("VALIDATION", "Versão de modelo comercial inválida ou não aprovada.");
}

/** Unidades: da operadora, vinculadas ao mesmo parceiro e fora de outro contrato não encerrado. */
async function validateSites(ctx: AuthContext, partnerId: string, siteIds: string[], exceptContractId?: string) {
  const sites = await db.site.findMany({ where: { id: { in: siteIds }, operatorId: ctx.organizationId, deletedAt: null } });
  if (sites.length !== new Set(siteIds).size) throw notFound("Unidade não encontrada.");
  const wrong = sites.find((s) => s.partnerOrganizationId !== partnerId);
  if (wrong) throw new AppError("VALIDATION", `A unidade "${wrong.name}" não está vinculada a este parceiro (ajuste no cadastro da unidade).`);
  const taken = await db.contractSite.findFirst({
    where: { siteId: { in: siteIds }, contract: { status: { not: "TERMINATED" }, ...(exceptContractId ? { id: { not: exceptContractId } } : {}) } },
    include: { site: true, contract: true },
  });
  if (taken) throw new AppError("CONFLICT", `A unidade "${taken.site.name}" já pertence ao contrato ${taken.contract.number}.`);
}

export async function createContract(ctx: AuthContext | null, raw: { contract: unknown; terms: unknown }) {
  requirePermission(ctx, "contract:write");
  requireOperator(ctx);
  const c = contractSchema.parse(raw.contract);
  const t = versionTermsSchema.parse(raw.terms);
  const partner = await db.organization.findFirst({ where: { id: c.partnerOrganizationId, kind: { in: ["PARTNER", "INVESTOR"] }, deletedAt: null } });
  if (!partner) throw notFound("Parceiro não encontrado.");
  await validateSites(ctx, partner.id, c.siteIds);
  await validateModelVersion(ctx, t.commercialModelVersionId);
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.organizationId, "CTR", (p) => tx.contract.count({ where: { operatorId: ctx.organizationId, number: { startsWith: p } } }));
    const contract = await tx.contract.create({
      data: { operatorId: ctx.organizationId, partnerOrganizationId: partner.id, number, title: c.title, createdById: ctx.userId, sites: { create: c.siteIds.map((siteId) => ({ siteId, addedById: ctx.userId })) } },
    });
    await tx.contractVersion.create({ data: { ...t, contractId: contract.id, version: 1, kind: "ORIGINAL", createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "contract.created", entityType: "Contract", entityId: contract.id, data: { number, partner: partner.name, sites: c.siteIds, reason: t.reason } }, tx);
    return contract;
  });
}

/** Aditivo: nova versão em rascunho; as anteriores permanecem como estão. */
export async function createAmendment(ctx: AuthContext | null, contractId: string, raw: unknown) {
  requirePermission(ctx, "contract:write");
  requireOperator(ctx);
  const t = versionTermsSchema.parse(raw);
  await validateModelVersion(ctx, t.commercialModelVersionId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"contract:" + contractId}))`;
    const contract = await tx.contract.findFirst({ where: { id: contractId, operatorId: ctx.organizationId }, include: { versions: true } });
    if (!contract) throw notFound("Contrato não encontrado.");
    if (contract.status === "TERMINATED") throw new AppError("CONFLICT", "Contrato encerrado não recebe aditivos.");
    if (contract.versions.some((v) => v.status === "DRAFT")) throw new AppError("CONFLICT", "Já existe uma versão em rascunho aguardando decisão.");
    const version = Math.max(...contract.versions.map((v) => v.version)) + 1;
    const v = await tx.contractVersion.create({ data: { ...t, contractId, version, kind: "AMENDMENT", createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "contract.amendment_created", entityType: "Contract", entityId: contractId, data: { version, reason: t.reason } }, tx);
    return v;
  });
}

/** Aprovação/recusa por pessoa autorizada e diferente do autor (quatro olhos). */
export async function decideContractVersion(ctx: AuthContext | null, versionId: string, raw: unknown) {
  requirePermission(ctx, "contract:approve");
  requireOperator(ctx);
  const d = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(raw);
  const v = await db.contractVersion.findFirst({ where: { id: versionId, contract: { operatorId: ctx.organizationId } }, include: { contract: true } });
  if (!v) throw notFound("Versão não encontrada.");
  if (v.status !== "DRAFT") throw new AppError("CONFLICT", "Somente versões em rascunho podem ser decididas.");
  if (v.createdById === ctx.userId) throw new AppError("FORBIDDEN", "A decisão deve ser tomada por um usuário diferente de quem criou a versão.");
  if (!d.approve && !d.note) throw new AppError("VALIDATION", "Informe o motivo da recusa.");
  if (d.approve && (await isPeriodClosed(ctx.organizationId, periodOf(v.effectiveFrom))))
    throw new AppError("CONFLICT", `A vigência começa em período já fechado (${periodOf(v.effectiveFrom)}). Use uma data em período aberto e registre ajuste para o passado.`);
  await db.$transaction(async (tx) => {
    const r = await tx.contractVersion.updateMany({
      where: { id: v.id, status: "DRAFT" },
      data: { status: d.approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note },
    });
    if (r.count !== 1) throw new AppError("CONFLICT", "A versão já foi decidida por outra pessoa.");
    if (d.approve && v.contract.status === "DRAFT") await tx.contract.update({ where: { id: v.contractId }, data: { status: "ACTIVE" } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: d.approve ? "contract.version_approved" : "contract.version_rejected", entityType: "Contract", entityId: v.contractId, data: { version: v.version, note: d.note } }, tx);
  });
}

export async function setContractStatus(ctx: AuthContext | null, contractId: string, raw: unknown) {
  requirePermission(ctx, "contract:approve");
  requireOperator(ctx);
  const d = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]), reason: z.string().trim().min(5, "Informe o motivo.").max(500) }).parse(raw);
  const c = await db.contract.findFirst({ where: { id: contractId, operatorId: ctx.organizationId }, include: { versions: true } });
  if (!c) throw notFound("Contrato não encontrado.");
  if (c.status === "TERMINATED") throw new AppError("CONFLICT", "Contrato encerrado não muda de status.");
  if (d.status === "ACTIVE" && !c.versions.some((v) => v.status === "APPROVED")) throw new AppError("CONFLICT", "Ative somente após aprovar uma versão.");
  await db.contract.update({ where: { id: c.id }, data: { status: d.status, statusReason: d.reason } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "contract.status_changed", entityType: "Contract", entityId: c.id, data: { from: c.status, to: d.status, reason: d.reason } });
}

export async function addContractSite(ctx: AuthContext | null, contractId: string, siteId: string) {
  requirePermission(ctx, "contract:write");
  requireOperator(ctx);
  const c = await db.contract.findFirst({ where: { id: contractId, operatorId: ctx.organizationId } });
  if (!c) throw notFound("Contrato não encontrado.");
  if (c.status === "TERMINATED") throw new AppError("CONFLICT", "Contrato encerrado.");
  await validateSites(ctx, c.partnerOrganizationId, [siteId], c.id);
  await db.contractSite.create({ data: { contractId, siteId, addedById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "contract.site_added", entityType: "Contract", entityId: c.id, data: { siteId } });
}

export async function listContracts(ctx: AuthContext | null) {
  requirePermission(ctx, "contract:read");
  requireOperator(ctx);
  const rows = await db.contract.findMany({
    where: { operatorId: ctx.organizationId },
    include: { partnerOrganization: { select: { name: true, kind: true } }, sites: { include: { site: { select: { name: true } } } }, versions: { orderBy: { version: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return rows.map((c) => ({ ...c, current: versionEffectiveAt(c.versions, now), pending: c.versions.find((v) => v.status === "DRAFT") ?? null }));
}

export async function getContract(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "contract:read");
  requireOperator(ctx);
  const c = await db.contract.findFirst({
    where: { id, operatorId: ctx.organizationId },
    include: {
      partnerOrganization: { select: { id: true, name: true, kind: true, document: true } },
      sites: { include: { site: { select: { id: true, name: true, city: true, state: true } } } },
      versions: { orderBy: { version: "desc" }, include: { commercialModelVersion: { select: { version: true, model: { select: { name: true } } } } } },
    },
  });
  if (!c) throw notFound("Contrato não encontrado.");
  const users = await db.user.findMany({ where: { id: { in: [...new Set(c.versions.flatMap((v) => [v.createdById, v.decidedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true } });
  return { ...c, current: versionEffectiveAt(c.versions, new Date()), userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}

export async function contractFormOptions(ctx: AuthContext | null) {
  requirePermission(ctx, "contract:write");
  requireOperator(ctx);
  const [partners, sites, modelVersions] = await Promise.all([
    db.organization.findMany({ where: { kind: { in: ["PARTNER", "INVESTOR"] }, deletedAt: null }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
    db.site.findMany({ where: { operatorId: ctx.organizationId, deletedAt: null, partnerOrganizationId: { not: null } }, select: { id: true, name: true, partnerOrganizationId: true }, orderBy: { name: "asc" } }),
    db.commercialModelVersion.findMany({ where: { status: "APPROVED", model: { organizationId: ctx.organizationId } }, select: { id: true, version: true, model: { select: { name: true } } } }),
  ]);
  return { partners, sites, modelVersions };
}
