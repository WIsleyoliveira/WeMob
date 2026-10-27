import Decimal from "decimal.js";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export const periodSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((p) => p.from <= p.to, { message: "Período inválido." });

/**
 * Métricas comerciais do período [from, to]. Definições (exibidas na interface):
 * - leadsBySource: leads CRIADOS no período, por origem.
 * - reachByStage: dos leads criados no período, quantos chegaram a cada etapa (posição máxima já
 *   alcançada, pelo histórico de mudanças + etapa atual; a etapa de perda não conta como avanço).
 * - stageConversion[i]: alcançaram etapa i+1 ÷ alcançaram etapa i.
 * - winRate: ganhos ÷ (ganhos + perdidos), entre leads ENCERRADOS no período.
 * - avgDaysToWin: média de dias entre criação e entrada na etapa de ganho, leads ganhos no período.
 * - openProposals: propostas em rascunho ou enviadas (hoje), com soma do total da última versão.
 * - weightedPipeline: Σ (valor estimado × probabilidade da etapa) dos leads em aberto com valor informado.
 */
export async function crmMetrics(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:read");
  const { from, to } = periodSchema.parse(raw);
  const org = ctx.organizationId;
  const [stages, created, closed, open, proposals] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { position: "asc" } }),
    db.lead.findMany({
      where: { organizationId: org, deletedAt: null, createdAt: { gte: from, lte: to } },
      select: { id: true, source: true, stageId: true, activities: { where: { kind: "STAGE_CHANGE" }, select: { data: true } } },
    }),
    db.lead.findMany({
      where: { organizationId: org, deletedAt: null, stageChangedAt: { gte: from, lte: to }, stage: { OR: [{ isWon: true }, { isLost: true }] } },
      select: { createdAt: true, stageChangedAt: true, stage: { select: { isWon: true } } },
    }),
    db.lead.findMany({
      where: { organizationId: org, deletedAt: null, stage: { isWon: false, isLost: false } },
      select: { estimatedValue: true, stage: { select: { probability: true } } },
    }),
    db.proposal.findMany({ where: { organizationId: org, status: { in: ["DRAFT", "SENT"] } }, select: { versions: { orderBy: { version: "desc" }, take: 1, select: { total: true } } } }),
  ]);

  const posById = new Map(stages.map((s) => [s.id, s]));
  const posByName = new Map(stages.map((s) => [s.name, s]));
  const progress = stages.filter((s) => !s.isLost);
  const reach = new Map(progress.map((s) => [s.id, 0]));
  const bySource = new Map<string, number>();
  for (const l of created) {
    bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
    const visited = [posById.get(l.stageId), ...l.activities.map((a) => {
      const d = (a.data ?? {}) as { toId?: string; to?: string };
      return (d.toId && posById.get(d.toId)) || (d.to && posByName.get(d.to)) || undefined;
    })].filter((s) => s && !s.isLost);
    const maxPos = Math.max(progress[0]?.position ?? 0, ...visited.map((s) => s!.position));
    for (const s of progress) if (s.position <= maxPos) reach.set(s.id, (reach.get(s.id) ?? 0) + 1);
  }
  const reachByStage = progress.map((s) => ({ stageId: s.id, name: s.name, reached: reach.get(s.id) ?? 0 }));
  const stageConversion = reachByStage.slice(0, -1).map((s, i) => ({
    from: s.name, to: reachByStage[i + 1].name, rate: s.reached > 0 ? reachByStage[i + 1].reached / s.reached : null,
  }));

  const won = closed.filter((l) => l.stage.isWon);
  const winRate = closed.length > 0 ? won.length / closed.length : null;
  const avgDaysToWin = won.length > 0 ? won.reduce((a, l) => a + (l.stageChangedAt.getTime() - l.createdAt.getTime()) / 86400000, 0) / won.length : null;

  const openProposalsTotal = proposals.reduce((a, p) => a.plus(p.versions[0]?.total.toString() ?? 0), new Decimal(0));
  const withValue = open.filter((l) => l.estimatedValue !== null);
  const weighted = withValue.reduce((a, l) => a.plus(new Decimal(l.estimatedValue!.toString()).mul(l.stage.probability.toString())), new Decimal(0));

  return {
    period: { from, to },
    computedAt: new Date(),
    leadsCreated: created.length,
    leadsBySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    reachByStage,
    stageConversion,
    closedInPeriod: closed.length,
    winRate,
    avgDaysToWin,
    openProposals: { count: proposals.length, total: openProposalsTotal.toFixed(2) },
    weightedPipeline: { value: weighted.toDecimalPlaces(2).toFixed(2), leadsWithValue: withValue.length, openLeads: open.length },
  };
}
