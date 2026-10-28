import { z } from "zod";
import type { CommercialModelVersion, CommercialModel } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { commercialVersionDraftSchema, type CommercialTerms } from "@/domain/commercial/types";
import { ENGINE_VERSION, runViability, viabilityInputSchema } from "@/domain/viability/engine";
import { getOperatorOrganization } from "@/server/modules/leads/service";
import { diffInputs } from "@/domain/viability/diff";

/** Versão vigente em `now`: aprovada, já iniciada e ainda não encerrada. */
export function effectiveWhere(now: Date) {
  return {
    status: "APPROVED" as const,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    ],
  };
}

export type VersionState = "DRAFT" | "SCHEDULED" | "EFFECTIVE" | "ENDED";
export function versionState(v: { status: string; effectiveFrom: Date | null; effectiveTo: Date | null }, now = new Date()): VersionState {
  if (v.status === "DRAFT") return "DRAFT";
  if (v.status === "RETIRED" || (v.effectiveTo && v.effectiveTo <= now)) return "ENDED";
  if (v.effectiveFrom && v.effectiveFrom > now) return "SCHEDULED";
  return "EFFECTIVE";
}

export function toTerms(v: CommercialModelVersion & { model: CommercialModel }): CommercialTerms {
  return {
    modelKey: v.model.key,
    modelName: v.model.name,
    versionId: v.id,
    version: v.version,
    referenceInvestment: v.referenceInvestment.toNumber(),
    partnerCapitalShare: v.partnerCapitalShare.toNumber(),
    partnerResultShare: v.partnerResultShare.toNumber(),
    royaltyRate: v.royaltyRate.toNumber(),
    royaltyBase: v.royaltyBase,
    platformFeeRate: v.platformFeeRate.toNumber(),
    platformFeeBase: v.platformFeeBase,
    taxRate: v.taxRate.toNumber(),
    taxBase: v.taxBase,
    platformFeeIncludesGateway: v.platformFeeIncludesGateway,
    lossTreatment: v.lossTreatment,
  };
}

/** Versões aprovadas e vigentes da operadora — informação comercial pública (site e simulador). */
export async function getPublicTerms() {
  const org = await getOperatorOrganization();
  const now = new Date();
  const versions = await db.commercialModelVersion.findMany({
    where: {
      model: { organizationId: org.id },
      ...effectiveWhere(now),
    },
    include: { model: true },
    orderBy: { model: { key: "asc" } },
  });
  return versions.map((v) => ({ terms: toTerms(v), maintenancePolicy: v.maintenancePolicy, responsibilities: v.responsibilities as { sansol: string[]; partner: string[] } | null, sourceNote: v.sourceNote, approvedAt: v.approvedAt }));
}

export async function listModels(ctx: AuthContext | null) {
  requirePermission(ctx, "commercial_model:read");
  return db.commercialModel.findMany({
    where: { organizationId: ctx.organizationId },
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { key: "asc" },
  });
}

export async function createDraftVersion(ctx: AuthContext | null, modelId: string, raw: unknown) {
  requirePermission(ctx, "commercial_model:write");
  requireOperator(ctx);
  const data = commercialVersionDraftSchema.parse(raw);
  const model = await db.commercialModel.findFirst({ where: { id: modelId, organizationId: ctx.organizationId } });
  if (!model) throw notFound("Modelo comercial não encontrado.");
  return db.$transaction(async (tx) => {
    const last = await tx.commercialModelVersion.findFirst({ where: { modelId }, orderBy: { version: "desc" } });
    const v = await tx.commercialModelVersion.create({
      data: { ...data, modelId, version: (last?.version ?? 0) + 1, status: "DRAFT", createdById: ctx.userId },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "commercial_version.created", entityType: "CommercialModelVersion", entityId: v.id, data: { version: v.version } }, tx);
    return v;
  });
}

/**
 * Aprova uma versão em rascunho (princípio dos quatro olhos: quem criou não aprova).
 * A versão aprovada anterior é encerrada; versões aprovadas são imutáveis, de modo que
 * simulações e contratos vinculados a elas nunca mudam retroativamente.
 */
export async function approveVersion(ctx: AuthContext | null, versionId: string) {
  requirePermission(ctx, "commercial_model:approve");
  requireOperator(ctx);
  const v = await db.commercialModelVersion.findFirst({ where: { id: versionId, model: { organizationId: ctx.organizationId } } });
  if (!v) throw notFound();
  if (v.status !== "DRAFT") throw new AppError("CONFLICT", "Somente versões em rascunho podem ser aprovadas.");
  if (v.createdById === ctx.userId) throw new AppError("FORBIDDEN", "A aprovação deve ser feita por um usuário diferente de quem criou a versão.");
  const now = new Date();
  const effectiveFrom = v.effectiveFrom && v.effectiveFrom > now ? v.effectiveFrom : now;
  const scheduled = await db.commercialModelVersion.findFirst({ where: { modelId: v.modelId, status: "APPROVED", effectiveFrom: { gt: now } } });
  if (scheduled) throw new AppError("CONFLICT", `Já existe a versão v${scheduled.version} agendada para este modelo. Aguarde sua vigência.`);
  return db.$transaction(async (tx) => {
    // A versão vigente continua valendo até o início da nova (sem lacuna de condições).
    await tx.commercialModelVersion.updateMany({
      where: { modelId: v.modelId, status: "APPROVED", OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }] },
      data: effectiveFrom > now ? { effectiveTo: effectiveFrom } : { status: "RETIRED", effectiveTo: effectiveFrom },
    });
    const approved = await tx.commercialModelVersion.update({
      where: { id: v.id, status: "DRAFT" },
      data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: now, effectiveFrom },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "commercial_version.approved", entityType: "CommercialModelVersion", entityId: v.id, data: { version: v.version } }, tx);
    return approved;
  });
}

export const saveSimulationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  versionId: z.string().min(1),
  leadId: z.string().optional(),
  /** Simulação anterior: a nova é registrada como revisão, com a lista de premissas alteradas. */
  parentId: z.string().optional(),
  // Os termos comerciais NUNCA vêm do cliente: são carregados da versão no banco.
  input: z.record(z.string(), z.unknown()),
});

export async function saveSimulation(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "simulation:run");
  const { name, versionId, leadId, input, parentId } = saveSimulationSchema.parse(raw);
  const parent = parentId ? await db.simulation.findFirst({ where: { id: parentId, organizationId: ctx.organizationId } }) : null;
  if (parentId && !parent) throw notFound("Simulação de origem não encontrada.");
  const version = await db.commercialModelVersion.findFirst({
    where: { id: versionId, model: { organizationId: ctx.organizationId } },
    include: { model: true },
  });
  if (!version) throw notFound("Versão do modelo comercial não encontrada.");
  if (leadId && !(await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId } }))) throw notFound("Lead não encontrado.");
  const parsed = viabilityInputSchema.parse({ ...input, terms: toTerms(version) });
  const results = runViability(parsed);
  const storedInputs = { ...parsed, versionStatusAtRun: version.status };
  const sim = await db.simulation.create({
    data: {
      parentId: parent?.id,
      revision: parent ? parent.revision + 1 : 1,
      changes: parent ? (diffInputs(parent.inputs, storedInputs) as object) : undefined,
      organizationId: ctx.organizationId,
      modelVersionId: version.id,
      leadId,
      name,
      inputs: storedInputs as object,
      results: results as unknown as object,
      engineVersion: ENGINE_VERSION,
      createdById: ctx.userId,
    },
  });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "simulation.saved", entityType: "Simulation", entityId: sim.id, data: { parentId: parent?.id ?? null, revision: sim.revision } });
  return sim;
}

export async function listSimulations(ctx: AuthContext | null) {
  requirePermission(ctx, "simulation:read");
  return db.simulation.findMany({
    where: { organizationId: ctx.organizationId },
    include: { modelVersion: { include: { model: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getSimulation(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "simulation:read");
  const s = await db.simulation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      modelVersion: { include: { model: true } },
      parent: { select: { id: true, name: true, revision: true } },
      revisions: { select: { id: true, name: true, revision: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!s) throw notFound();
  const author = s.createdById ? await db.user.findUnique({ where: { id: s.createdById }, select: { name: true } }) : null;
  return { ...s, authorName: author?.name ?? null };
}

export async function listApprovedVersions(ctx: AuthContext | null) {
  requirePermission(ctx, "simulation:run");
  const vs = await db.commercialModelVersion.findMany({
    where: { model: { organizationId: ctx.organizationId }, OR: [effectiveWhere(new Date()), { status: "DRAFT" }] },
    include: { model: true },
    orderBy: [{ model: { key: "asc" } }, { version: "desc" }],
  });
  // Vigentes primeiro (padrão do simulador); rascunhos depois, identificados na interface.
  return vs
    .sort((a, b) => Number(a.status === "DRAFT") - Number(b.status === "DRAFT"))
    .map((v) => ({ id: v.id, status: v.status, terms: toTerms(v) }));
}
