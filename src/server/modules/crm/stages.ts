import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export const stageUpdateSchema = z.object({
  stageId: z.string(),
  name: z.string().trim().min(2).max(60),
  probabilityPct: z.coerce.number().min(0).max(100),
});

export async function updateStage(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "crm:configure");
  const d = stageUpdateSchema.parse(raw);
  const s = await db.pipelineStage.findFirst({ where: { id: d.stageId, organizationId: ctx.organizationId } });
  if (!s) throw notFound();
  if (s.isWon && d.probabilityPct !== 100) throw new AppError("VALIDATION", "A etapa de ganho tem probabilidade fixa de 100%.");
  if (s.isLost && d.probabilityPct !== 0) throw new AppError("VALIDATION", "A etapa de perda tem probabilidade fixa de 0%.");
  await db.pipelineStage.update({ where: { id: s.id }, data: { name: d.name, probability: d.probabilityPct / 100 } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "pipeline_stage.updated", entityType: "PipelineStage", entityId: s.id, data: { name: d.name, probability: d.probabilityPct / 100 } });
}

/** Cria etapa intermediária imediatamente antes da etapa de ganho. */
export async function createStage(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "crm:configure");
  const d = z.object({ name: z.string().trim().min(2).max(60), probabilityPct: z.coerce.number().min(0).max(99) }).parse(raw);
  return db.$transaction(async (tx) => {
    const stages = await tx.pipelineStage.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { position: "asc" } });
    const won = stages.find((s) => s.isWon);
    if (!won) throw new AppError("CONFLICT", "Funil sem etapa de ganho.");
    const key = `etapa-${Date.now().toString(36)}`;
    for (const s of stages.filter((x) => x.position >= won.position).reverse()) {
      await tx.pipelineStage.update({ where: { id: s.id }, data: { position: s.position + 1 } });
    }
    const created = await tx.pipelineStage.create({ data: { organizationId: ctx.organizationId, key, name: d.name, position: won.position, probability: d.probabilityPct / 100 } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "pipeline_stage.created", entityType: "PipelineStage", entityId: created.id }, tx);
    return created;
  });
}
