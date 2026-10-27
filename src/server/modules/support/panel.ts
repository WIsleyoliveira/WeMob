/**
 * Painel operacional. Fórmulas (exibidas na tela):
 *  - Disponibilidade = média, por conector, de (tempo fora de Indisponível/Em falha/Sem comunicação ÷ período).
 *  - Indisponibilidade (h) = Σ conectores (1 − disponibilidade) × horas do período.
 *  - MTTR = média de (resolvido em − aberto em), relógio corrido, dos tickets de falha/conectividade resolvidos no período.
 *  - Cumprimento de SLA = tickets resolvidos no período dentro do prazo de solução (tempo de SLA, descontadas pausas)
 *    ÷ tickets resolvidos no período que têm SLA.
 */
import { db } from "@/server/db";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { operationalOverview } from "@/server/modules/stations/service";
import { ticketSla } from "./tickets";

export async function opsPanel(ctx: AuthContext | null, raw: { from: Date; to: Date; includeNonProduction?: boolean }) {
  requirePermission(ctx, "support:read");
  requireOperator(ctx);
  const overview = await operationalOverview(ctx, raw);
  const end = raw.to < new Date() ? raw.to : new Date();
  const hours = Math.max(0, (end.getTime() - raw.from.getTime()) / 3600_000);
  const conns = overview.perConnector;
  const availability = conns.length ? conns.reduce((a, c) => a + c.availability, 0) / conns.length : null;
  const downtimeHours = conns.reduce((a, c) => a + (1 - c.availability) * hours, 0);

  const resolved = await db.ticket.findMany({
    where: { operatorId: ctx.organizationId, resolvedAt: { gte: raw.from, lte: raw.to } },
    include: { events: { where: { kind: { in: ["PAUSE", "RESUME"] } }, select: { kind: true, createdAt: true } } },
  });
  const repair = resolved.filter((t) => ["CHARGER_FAULT", "CONNECTIVITY"].includes(t.category));
  const mttrHours = repair.length ? repair.reduce((a, t) => a + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) / repair.length / 3600_000 : null;
  const withSla = resolved.filter((t) => t.slaResolutionMinutes);
  const met = withSla.filter((t) => ticketSla(t, t.events).resolution.state === "MET").length;
  const responded = resolved.filter((t) => t.slaResponseMinutes && t.firstResponseAt);
  const responseMet = responded.filter((t) => ticketSla(t, t.events).response.state === "MET").length;

  const [openTickets, openAlerts, completedWo] = await Promise.all([
    db.ticket.count({ where: { operatorId: ctx.organizationId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_REQUESTER"] } } }),
    db.alert.groupBy({ by: ["severity"], where: { operatorId: ctx.organizationId, status: { not: "RESOLVED" } }, _count: true }),
    db.workOrder.count({ where: { operatorId: ctx.organizationId, status: "COMPLETED", completedAt: { gte: raw.from, lte: raw.to } } }),
  ]);
  return {
    period: { from: raw.from, to: raw.to },
    computedAt: new Date(),
    environments: overview.environments,
    connectors: conns.length,
    availability,
    downtimeHours,
    unknownShare: conns.length ? conns.reduce((a, c) => a + c.unknownShare, 0) / conns.length : null,
    mttrHours,
    repairTickets: repair.length,
    slaCompliance: withSla.length ? met / withSla.length : null,
    slaResolvedWithTarget: withSla.length,
    slaMet: met,
    responseCompliance: responded.length ? responseMet / responded.length : null,
    openTickets,
    openAlerts: Object.fromEntries(openAlerts.map((a) => [a.severity, a._count])) as Partial<Record<"WARNING" | "CRITICAL", number>>,
    completedWorkOrders: completedWo,
    perConnector: conns,
  };
}
