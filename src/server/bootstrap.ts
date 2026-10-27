import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { PORTFOLIO_SOURCE_NOTE, REFERENCE_RESPONSIBILITIES, REFERENCE_TERMS } from "@/domain/commercial/reference";

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
  { key: "novo", name: "Novo lead" },
  { key: "qualificacao", name: "Qualificação" },
  { key: "estudo", name: "Estudo de viabilidade" },
  { key: "proposta", name: "Proposta enviada" },
  { key: "negociacao", name: "Negociação" },
  { key: "ganho", name: "Ganho", isWon: true },
  { key: "perdido", name: "Perdido", isLost: true },
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
  for (const terms of Object.values(REFERENCE_TERMS)) {
    const model = await db.commercialModel.upsert({
      where: { organizationId_key: { organizationId, key: terms.modelKey } },
      create: {
        organizationId,
        key: terms.modelKey,
        name: terms.modelName,
        description:
          terms.modelKey === "compra-integral"
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
        sourceNote: `${PORTFOLIO_SOURCE_NOTE} Versão 1 criada pelo seed como referência — revisar e reaprovar antes de uso contratual.`,
      },
    });
  }
}
