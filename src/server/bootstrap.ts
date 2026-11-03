import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { ensureDefaultAlertRules } from "@/server/modules/alerts/rules";
import { ensurePlatformCostDefaults } from "@/server/modules/costs/service";
import { LEGACY_14_MODEL_KEYS, OFFICIAL_REVENUE_SHARE, PORTFOLIO_SOURCE_NOTE, REFERENCE_RESPONSIBILITIES, REFERENCE_TERMS, REVENUE_SHARE_TERMS } from "@/domain/commercial/reference";

/** Estrutura mínima idempotente: perfis de sistema, operadora, funil e modelos de referência. */
export async function ensureSystemRoles(db: PrismaClient) {
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    const existing = await db.role.findFirst({ where: { organizationId: null, key } });
    if (existing) await db.role.update({ where: { id: existing.id }, data: { name: r.name, permissions: r.permissions } });
    else await db.role.create({ data: { key, name: r.name, permissions: r.permissions } });
  }
}

export async function ensureOperator(db: PrismaClient, name = "Sansol Mob") {
  return (
    (await db.organization.findFirst({ where: { kind: "OPERATOR", deletedAt: null }, orderBy: { createdAt: "asc" } })) ??
    db.organization.create({ data: { name, kind: "OPERATOR" } })
  );
}

export const DEFAULT_STAGES = [
  { key: "novo", name: "Novo lead", probability: 0.05 },
  { key: "qualificacao", name: "Qualificação", probability: 0.1 },
  { key: "estudo", name: "Estudo de viabilidade", probability: 0.25 },
  { key: "proposta", name: "Proposta enviada", probability: 0.5 },
  { key: "negociacao", name: "Negociação", probability: 0.7 },
  { key: "ganho", name: "Ganho", isWon: true, probability: 1 },
  { key: "perdido", name: "Perdido", isLost: true, probability: 0 },
];

export async function ensureStages(db: PrismaClient, organizationId: string) {
  for (const [i, s] of DEFAULT_STAGES.entries()) {
    await db.pipelineStage.upsert({
      where: { organizationId_key: { organizationId, key: s.key } },
      create: { organizationId, position: i, ...s },
      update: {},
    });
  }
}

export async function ensureReferenceModels(db: PrismaClient, organizationId: string) {
  for (const terms of [...Object.values(REFERENCE_TERMS), REVENUE_SHARE_TERMS]) {
    const model = await db.commercialModel.upsert({
      where: { organizationId_key: { organizationId, key: terms.modelKey } },
      create: {
        organizationId,
        key: terms.modelKey,
        name: terms.modelName,
        description:
          terms.modelKey === OFFICIAL_REVENUE_SHARE.modelKey
            ? "A WeMob recebe 30% do faturamento bruto mensal do posto e o operador do posto, 70%."
            : terms.modelKey === "compra-integral"
              ? "O investidor aporta a implantação e recebe o resultado das recargas, utilizando a marca Sansol Mob."
              : "Sansol Mob e parceiro investem juntos e dividem custos e resultado líquido da unidade.",
      },
      update: {},
    });
    const hasVersion = await db.commercialModelVersion.findFirst({ where: { modelId: model.id } });
    if (hasVersion) continue;
    const { modelKey, modelName: _n, versionId: _v, version: _ver, ...rest } = terms;
    await db.commercialModelVersion.create({
      data: {
        ...rest,
        modelId: model.id,
        version: 1,
        status: "APPROVED",
        approvedAt: new Date(),
        effectiveFrom: new Date(),
        maintenancePolicy: "Cobrada quando houver, conforme condições contratadas.",
        responsibilities: REFERENCE_RESPONSIBILITIES[modelKey as keyof typeof REFERENCE_RESPONSIBILITIES] as unknown as object,
        sourceNote:
          terms.modelKey === OFFICIAL_REVENUE_SHARE.modelKey
            ? `${OFFICIAL_REVENUE_SHARE.sourceNote} Versão 1 criada pelo seed.`
            : `${PORTFOLIO_SOURCE_NOTE} Versão 1 criada pelo seed como referência — revisar e reaprovar antes de uso contratual.`,
      },
    });
  }
}

/**
 * A taxa de 14% (sistema + gateway) foi SUBSTITUÍDA pela participação 30/70: versões vigentes dos modelos antigos que
 * ainda cobram 14% saem de vigência (RETIRED, `effectiveTo` = agora). Contratos e simulações guardam a própria cópia das
 * condições e não mudam (nada retroativo). Idempotente; roda só no seed (não no bootstrap dos testes).
 */
export async function retireLegacy14Models(db: PrismaClient, organizationId: string, now = new Date()) {
  const targets = await db.commercialModelVersion.findMany({
    where: { model: { organizationId, key: { in: [...LEGACY_14_MODEL_KEYS] } }, status: "APPROVED", platformFeeRate: 0.14, revenueShareRate: null },
    select: { id: true, version: true, model: { select: { key: true } } },
  });
  for (const v of targets) {
    await db.commercialModelVersion.update({ where: { id: v.id }, data: { status: "RETIRED", effectiveTo: now } });
    await db.auditEvent.create({ data: { organizationId, action: "commercial_version.retired_legacy_14", entityType: "CommercialModelVersion", entityId: v.id, data: { model: v.model.key, version: v.version, reason: "Taxa de 14% substituída pela participação 30/70 (regra oficial WAPE, 2026-11-03)." } } });
  }
  return targets.length;
}

/** SLA inicial por prioridade (24×7). Ajustável em /app/suporte/configurar — referência, não compromisso contratual. */
export const DEFAULT_SLA = [
  { priority: "CRITICAL", responseMinutes: 30, resolutionMinutes: 240 },
  { priority: "HIGH", responseMinutes: 60, resolutionMinutes: 480 },
  { priority: "MEDIUM", responseMinutes: 240, resolutionMinutes: 1440 },
  { priority: "LOW", responseMinutes: 480, resolutionMinutes: 4320 },
] as const;

export async function ensureOperationsDefaults(db: PrismaClient, operatorId: string) {
  // Orçamento de custos da plataforma: premissas da planilha (editáveis), só se ainda não houver.
  await ensurePlatformCostDefaults(db, operatorId);
  await ensureDefaultAlertRules(db, operatorId);
  for (const p of DEFAULT_SLA) {
    const exists = await db.slaPolicy.findFirst({ where: { operatorId, priority: p.priority, contractId: null, active: true } });
    if (!exists) await db.slaPolicy.create({ data: { operatorId, ...p } });
  }
}
