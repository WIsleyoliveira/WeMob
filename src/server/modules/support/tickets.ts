/**
 * Tickets de suporte com SLA. O ticket guarda cópia da política na criação (ou na troca de
 * prioridade); pausas exigem motivo e ficam no histórico (PAUSE/RESUME), que é a fonte do cálculo.
 */
import { z } from "zod";
import type { Prisma, TicketCategory, TicketOrigin, TicketPriority, TicketStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequence";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { CALENDAR_24X7, pausesFromEvents, slaElapsedMinutes, slaState, type SlaCalendar } from "@/domain/support/sla";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em atendimento",
  WAITING_THIRD_PARTY: "Aguardando terceiro (SLA pausado)",
  WAITING_REQUESTER: "Aguardando solicitante (SLA pausado)",
  RESOLVED: "Resolvido",
  CLOSED: "Fechado",
  CANCELLED: "Cancelado",
};
export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  CHARGER_FAULT: "Falha no carregador",
  CONNECTIVITY: "Comunicação / conectividade",
  PAYMENT: "Pagamento",
  DRIVER_SUPPORT: "Atendimento ao motorista",
  INSTALLATION: "Instalação",
  PREVENTIVE: "Preventiva",
  OTHER: "Outro",
};
export const PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };
export const ORIGIN_LABEL: Record<TicketOrigin, string> = { MANUAL: "Equipe", DRIVER: "Motorista", ALERT: "Alerta automático", PARTNER: "Parceiro", PREVENTIVE: "Preventiva" };

const PAUSED: TicketStatus[] = ["WAITING_THIRD_PARTY", "WAITING_REQUESTER"];
const DONE: TicketStatus[] = ["RESOLVED", "CLOSED", "CANCELLED"];
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_THIRD_PARTY", "WAITING_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_THIRD_PARTY: ["IN_PROGRESS", "WAITING_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_REQUESTER: ["IN_PROGRESS", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

type Tx = Prisma.TransactionClient;

/** Política ativa: a do contrato da unidade, se houver; senão a geral da prioridade. */
async function slaSnapshot(tx: Tx, operatorId: string, priority: TicketPriority, contractId: string | null) {
  const policies = await tx.slaPolicy.findMany({ where: { operatorId, priority, active: true, OR: [{ contractId: null }, ...(contractId ? [{ contractId }] : [])] } });
  const p = policies.find((x) => x.contractId === contractId && contractId) ?? policies.find((x) => !x.contractId);
  if (!p) return { slaPolicyId: null, slaResponseMinutes: null, slaResolutionMinutes: null, slaCalendar: undefined };
  const calendar: SlaCalendar = { businessHoursOnly: p.businessHoursOnly, workStartHour: p.workStartHour, workEndHour: p.workEndHour, workDays: p.workDays };
  return { slaPolicyId: p.id, slaResponseMinutes: p.responseMinutes, slaResolutionMinutes: p.resolutionMinutes, slaCalendar: calendar as unknown as Prisma.InputJsonValue };
}

export interface NewTicket {
  operatorId: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  origin: TicketOrigin;
  stationId?: string | null;
  siteId?: string | null;
  supportRequestId?: string;
  createdById?: string | null;
}

/** Criação interna (equipe, alerta, motorista). Valida que estação/unidade pertencem à operadora. */
export async function createTicketTx(tx: Tx, t: NewTicket) {
  let siteId = t.siteId ?? null;
  if (t.stationId) {
    const st = await tx.chargingStation.findFirst({ where: { id: t.stationId, operatorId: t.operatorId, deletedAt: null } });
    if (!st) throw notFound("Estação não encontrada.");
    siteId = st.siteId;
  } else if (siteId && !(await tx.site.findFirst({ where: { id: siteId, operatorId: t.operatorId, deletedAt: null } }))) throw notFound("Unidade não encontrada.");
  const contractId = siteId ? (await tx.contractSite.findFirst({ where: { siteId, contract: { status: { in: ["ACTIVE", "SUSPENDED"] } } } }))?.contractId ?? null : null;
  const number = await nextNumber(tx, t.operatorId, "TCK", (p) => tx.ticket.count({ where: { operatorId: t.operatorId, number: { startsWith: p } } }), 5);
  const ticket = await tx.ticket.create({
    data: {
      operatorId: t.operatorId, number, title: t.title, description: t.description, category: t.category, priority: t.priority, origin: t.origin,
      stationId: t.stationId ?? null, siteId, contractId, supportRequestId: t.supportRequestId, createdById: t.createdById ?? null,
      ...(await slaSnapshot(tx, t.operatorId, t.priority, contractId)),
    },
  });
  await tx.ticketEvent.create({ data: { ticketId: ticket.id, kind: "CREATED", authorId: t.createdById ?? null, body: `Ticket ${number} aberto (${ORIGIN_LABEL[t.origin]}).` } });
  return ticket;
}

export const ticketSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(5000),
  category: z.enum(["CHARGER_FAULT", "CONNECTIVITY", "PAYMENT", "DRIVER_SUPPORT", "INSTALLATION", "PREVENTIVE", "OTHER"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  stationId: z.string().optional().transform((v) => v || undefined),
  siteId: z.string().optional().transform((v) => v || undefined),
});

export async function createTicket(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:write");
  requireOperator(ctx);
  const d = ticketSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const t = await createTicketTx(tx, { ...d, operatorId: ctx.organizationId, origin: "MANUAL", createdById: ctx.userId });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "ticket.created", entityType: "Ticket", entityId: t.id, data: { number: t.number, priority: d.priority } }, tx);
    return t;
  });
}

async function loadOwned(tx: Tx, ctx: AuthContext, ticketId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ticket:" + ticketId}))`;
  const t = await tx.ticket.findFirst({ where: { id: ticketId, operatorId: ctx.organizationId } });
  if (!t) throw notFound("Ticket não encontrado.");
  return t;
}

export async function changeTicketStatus(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:write");
  requireOperator(ctx);
  const d = z.object({ ticketId: z.string(), status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_REQUESTER", "RESOLVED", "CLOSED", "CANCELLED"]), reason: z.string().trim().max(1000).optional() }).parse(raw);
  await db.$transaction(async (tx) => {
    const t = await loadOwned(tx, ctx, d.ticketId);
    if (!TICKET_TRANSITIONS[t.status].includes(d.status)) throw new AppError("CONFLICT", `Transição inválida: ${TICKET_STATUS_LABEL[t.status]} → ${TICKET_STATUS_LABEL[d.status]}.`);
    const needsReason = PAUSED.includes(d.status) || d.status === "RESOLVED" || d.status === "CANCELLED" || (t.status === "RESOLVED" && d.status === "IN_PROGRESS");
    if (needsReason && (!d.reason || d.reason.length < 5)) throw new AppError("VALIDATION", "Informe o motivo / a descrição da solução (mín. 5 caracteres).");
    const now = new Date();
    const wasPaused = PAUSED.includes(t.status);
    const willPause = PAUSED.includes(d.status);
    if (wasPaused && !willPause) await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "RESUME", authorId: ctx.userId, body: "SLA retomado." } });
    if (!wasPaused && willPause) await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "PAUSE", authorId: ctx.userId, body: d.reason } });
    await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "STATUS_CHANGE", authorId: ctx.userId, body: d.reason, data: { from: t.status, to: d.status } } });
    await tx.ticket.update({
      where: { id: t.id },
      data: {
        status: d.status,
        pausedSince: willPause ? (wasPaused ? t.pausedSince : now) : null,
        firstResponseAt: t.firstResponseAt ?? (d.status !== "OPEN" ? now : null),
        resolvedAt: d.status === "RESOLVED" ? now : d.status === "IN_PROGRESS" ? null : t.resolvedAt,
        closedAt: d.status === "CLOSED" || d.status === "CANCELLED" ? now : null,
      },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "ticket.status_changed", entityType: "Ticket", entityId: t.id, data: { from: t.status, to: d.status } }, tx);
  });
}

export async function addTicketComment(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:write");
  requireOperator(ctx);
  const d = z.object({ ticketId: z.string(), body: z.string().trim().min(2).max(5000) }).parse(raw);
  await db.$transaction(async (tx) => {
    const t = await loadOwned(tx, ctx, d.ticketId);
    if (["CLOSED", "CANCELLED"].includes(t.status)) throw new AppError("CONFLICT", "Ticket encerrado não recebe comentários.");
    await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "COMMENT", authorId: ctx.userId, body: d.body } });
    if (!t.firstResponseAt) await tx.ticket.update({ where: { id: t.id }, data: { firstResponseAt: new Date() } });
  });
}

export async function assignTicket(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:write");
  requireOperator(ctx);
  const d = z.object({ ticketId: z.string(), assigneeId: z.string().optional().transform((v) => v || null) }).parse(raw);
  if (d.assigneeId && !(await db.membership.findFirst({ where: { userId: d.assigneeId, organizationId: ctx.organizationId, revokedAt: null } }))) throw notFound("Responsável não encontrado nesta organização.");
  await db.$transaction(async (tx) => {
    const t = await loadOwned(tx, ctx, d.ticketId);
    await tx.ticket.update({ where: { id: t.id }, data: { assigneeId: d.assigneeId } });
    await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "ASSIGNMENT", authorId: ctx.userId, data: { from: t.assigneeId, to: d.assigneeId } } });
  });
}

/** Troca de prioridade recalcula os prazos pela política vigente (registrado no histórico). */
export async function changeTicketPriority(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:write");
  requireOperator(ctx);
  const d = z.object({ ticketId: z.string(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), reason: z.string().trim().min(5, "Informe o motivo.").max(500) }).parse(raw);
  await db.$transaction(async (tx) => {
    const t = await loadOwned(tx, ctx, d.ticketId);
    if (DONE.includes(t.status)) throw new AppError("CONFLICT", "Ticket já resolvido/encerrado.");
    await tx.ticket.update({ where: { id: t.id }, data: { priority: d.priority, ...(await slaSnapshot(tx, ctx.organizationId, d.priority, t.contractId)) } });
    await tx.ticketEvent.create({ data: { ticketId: t.id, kind: "PRIORITY_CHANGE", authorId: ctx.userId, body: d.reason, data: { from: t.priority, to: d.priority } } });
  });
}

/** Situação de SLA de resposta e de solução, descontando pausas. */
export function ticketSla(t: { createdAt: Date; firstResponseAt: Date | null; resolvedAt: Date | null; slaResponseMinutes: number | null; slaResolutionMinutes: number | null; slaCalendar: unknown }, events: { kind: string; createdAt: Date }[], now = new Date()) {
  const cal = (t.slaCalendar as SlaCalendar | null) ?? CALENDAR_24X7;
  const pauses = pausesFromEvents(events);
  const responseElapsed = slaElapsedMinutes(t.createdAt, t.firstResponseAt ?? now, pauses, cal);
  const resolutionElapsed = slaElapsedMinutes(t.createdAt, t.resolvedAt ?? now, pauses, cal);
  return {
    calendar: cal,
    pauses,
    response: { target: t.slaResponseMinutes, elapsed: responseElapsed, state: slaState(t.slaResponseMinutes, responseElapsed, !!t.firstResponseAt) },
    resolution: { target: t.slaResolutionMinutes, elapsed: resolutionElapsed, state: slaState(t.slaResolutionMinutes, resolutionElapsed, !!t.resolvedAt) },
  };
}

export const ticketFilterSchema = z.object({
  status: z.enum(["open", "done", "all"]).default("open"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  mine: z.coerce.boolean().optional(),
});

export async function listTickets(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "support:read");
  requireOperator(ctx);
  const f = ticketFilterSchema.parse(raw);
  const rows = await db.ticket.findMany({
    where: {
      operatorId: ctx.organizationId,
      ...(f.status === "open" ? { status: { notIn: DONE } } : f.status === "done" ? { status: { in: DONE } } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
      ...(f.mine ? { assigneeId: ctx.userId } : {}),
    },
    include: { assignee: { select: { name: true } }, station: { select: { ocppIdentity: true } }, site: { select: { name: true } }, events: { where: { kind: { in: ["PAUSE", "RESUME"] } }, select: { kind: true, createdAt: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  const now = new Date();
  return rows.map(({ events, ...t }) => ({ ...t, sla: ticketSla(t, events, now) }));
}

export async function getTicket(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "support:read");
  requireOperator(ctx);
  const t = await db.ticket.findFirst({
    where: { id, operatorId: ctx.organizationId },
    include: {
      assignee: { select: { id: true, name: true } },
      station: { select: { id: true, ocppIdentity: true } },
      site: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "asc" } },
      workOrders: { select: { id: true, number: true, status: true, type: true, title: true } },
      alert: { select: { id: true, title: true, status: true } },
    },
  });
  if (!t) throw notFound("Ticket não encontrado.");
  const authorIds = [...new Set(t.events.map((e) => e.authorId).filter(Boolean) as string[])];
  const users = await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } });
  return { ...t, sla: ticketSla(t, t.events), authorNames: Object.fromEntries(users.map((u) => [u.id, u.name])) };
}

export async function supportFormOptions(ctx: AuthContext | null) {
  requirePermission(ctx, "support:read");
  requireOperator(ctx);
  const [stations, sites, members] = await Promise.all([
    db.chargingStation.findMany({ where: { operatorId: ctx.organizationId, deletedAt: null }, select: { id: true, ocppIdentity: true, environment: true, site: { select: { name: true } } }, orderBy: { ocppIdentity: "asc" } }),
    db.site.findMany({ where: { operatorId: ctx.organizationId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { organizationId: ctx.organizationId, revokedAt: null, user: { disabledAt: null } }, select: { user: { select: { id: true, name: true } } } }),
  ]);
  return { stations, sites, members: members.map((m) => m.user) };
}

// ── SLA configurável ──

export const slaPolicySchema = z
  .object({
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    contractId: z.string().optional().transform((v) => v || undefined),
    responseMinutes: z.coerce.number().int().min(1).max(60 * 24 * 30),
    resolutionMinutes: z.coerce.number().int().min(1).max(60 * 24 * 90),
    businessHoursOnly: z.boolean().default(false),
    workStartHour: z.coerce.number().int().min(0).max(23).default(8),
    workEndHour: z.coerce.number().int().min(1).max(24).default(18),
    workDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  })
  .refine((p) => p.workEndHour > p.workStartHour, { message: "O fim do expediente deve ser após o início.", path: ["workEndHour"] })
  .refine((p) => p.resolutionMinutes >= p.responseMinutes, { message: "O prazo de solução deve ser ≥ ao de resposta.", path: ["resolutionMinutes"] });

/** Nova política substitui a ativa (que é desativada, não apagada). Tickets existentes mantêm a cópia. */
export async function saveSlaPolicy(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "support:configure");
  requireOperator(ctx);
  const d = slaPolicySchema.parse(raw);
  if (d.contractId && !(await db.contract.findFirst({ where: { id: d.contractId, operatorId: ctx.organizationId } }))) throw notFound("Contrato não encontrado.");
  await db.$transaction(async (tx) => {
    await tx.slaPolicy.updateMany({ where: { operatorId: ctx.organizationId, priority: d.priority, contractId: d.contractId ?? null, active: true }, data: { active: false } });
    const p = await tx.slaPolicy.create({ data: { ...d, contractId: d.contractId ?? null, operatorId: ctx.organizationId, createdById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "sla.policy_saved", entityType: "SlaPolicy", entityId: p.id, data: d }, tx);
  });
}

export async function listSlaPolicies(ctx: AuthContext | null) {
  requirePermission(ctx, "support:read");
  requireOperator(ctx);
  return db.slaPolicy.findMany({ where: { operatorId: ctx.organizationId, active: true }, orderBy: [{ contractId: "asc" }, { priority: "asc" }] });
}

/** Solicitações do portal do motorista viram tickets (uma única vez por solicitação). */
export async function importDriverSupportRequests(operatorId: string) {
  const pending = await db.supportRequest.findMany({ where: { status: "OPEN" }, take: 100, orderBy: { createdAt: "asc" } });
  let created = 0;
  for (const r of pending) {
    if (await db.ticket.findUnique({ where: { supportRequestId: r.id } })) continue;
    const session = r.sessionId ? await db.chargingSession.findUnique({ where: { id: r.sessionId }, include: { station: true } }) : null;
    if (session && session.station.operatorId !== operatorId) continue;
    if (!session) {
      // Sem sessão: vai para a operadora principal da rede (a mais antiga).
      const primary = await db.organization.findFirst({ where: { kind: "OPERATOR", deletedAt: null }, orderBy: { createdAt: "asc" } });
      if (primary?.id !== operatorId) continue;
    }
    try {
      await db.$transaction(async (tx) => {
        await createTicketTx(tx, {
          operatorId, title: `Motorista: ${r.subject}`.slice(0, 160), description: r.message, category: "DRIVER_SUPPORT", priority: "MEDIUM", origin: "DRIVER",
          stationId: session?.stationId ?? null, supportRequestId: r.id,
        });
        await tx.supportRequest.update({ where: { id: r.id }, data: { status: "TICKET" } });
      });
      created++;
    } catch (e) {
      if (!(e instanceof Error && "code" in e && (e as { code: string }).code === "P2002")) throw e;
    }
  }
  return created;
}
