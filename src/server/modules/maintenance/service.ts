/**
 * Ordens de serviço (corretivas e preventivas) e planos de manutenção preventiva.
 * Conclusão exige checklist completo, descrição e ao menos uma evidência anexada; o custo
 * (mão de obra + peças) vira despesa de manutenção a pagar na competência da conclusão.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { Prisma, type WorkOrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { nextNumber } from "@/server/sequence";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { planDue, type UsageSince } from "@/domain/maintenance/plan";
import { periodOf } from "@/domain/finance/period";
import { lockOpenPeriod } from "@/server/modules/finance/periods";
import { sessionEnergyWh } from "@/server/modules/stations/service";

export const WO_STATUS_LABEL: Record<WorkOrderStatus, string> = { OPEN: "Aberta", SCHEDULED: "Agendada", IN_PROGRESS: "Em execução", COMPLETED: "Concluída", CANCELLED: "Cancelada" };
export const TRIGGER_LABEL = { TIME: "Por tempo", ENERGY_KWH: "Por energia entregue (kWh)", SESSIONS: "Por número de sessões" } as const;
export type ChecklistItem = { item: string; done: boolean };

const ACTIVE: WorkOrderStatus[] = ["OPEN", "SCHEDULED", "IN_PROGRESS"];
const r2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const workOrderSchema = z.object({
  stationId: z.string().min(1, "Selecione a estação."),
  title: z.string().trim().min(3).max(160),
  ticketId: z.string().optional().transform((v) => v || undefined),
  diagnosis: z.string().trim().max(3000).optional(),
  checklist: z.array(z.string().trim().min(2).max(200)).max(40).default([]),
});

type Tx = Prisma.TransactionClient;

async function createWorkOrderTx(tx: Tx, operatorId: string, d: { stationId: string; title: string; type: "CORRECTIVE" | "PREVENTIVE"; ticketId?: string; planId?: string; diagnosis?: string; checklist: string[]; createdById: string }) {
  const number = await nextNumber(tx, operatorId, "OS", (p) => tx.workOrder.count({ where: { operatorId, number: { startsWith: p } } }), 5);
  const wo = await tx.workOrder.create({
    data: { operatorId, number, type: d.type, title: d.title, stationId: d.stationId, ticketId: d.ticketId, planId: d.planId, diagnosis: d.diagnosis, createdById: d.createdById, checklist: d.checklist.map((item) => ({ item, done: false })) },
  });
  if (d.ticketId) await tx.ticketEvent.create({ data: { ticketId: d.ticketId, kind: "WORK_ORDER", authorId: d.createdById, body: `${number} aberta: ${d.title}`, data: { workOrderId: wo.id } } });
  return wo;
}

export async function createWorkOrder(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = workOrderSchema.parse(raw);
  const st = await db.chargingStation.findFirst({ where: { id: d.stationId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!st) throw notFound("Estação não encontrada.");
  if (d.ticketId && !(await db.ticket.findFirst({ where: { id: d.ticketId, operatorId: ctx.organizationId } }))) throw notFound("Ticket não encontrado.");
  return db.$transaction(async (tx) => {
    const wo = await createWorkOrderTx(tx, ctx.organizationId, { ...d, type: "CORRECTIVE", createdById: ctx.userId });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "work_order.created", entityType: "WorkOrder", entityId: wo.id, data: { number: wo.number } }, tx);
    return wo;
  });
}

async function loadActive(tx: Tx, ctx: AuthContext, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wo:" + id}))`;
  const wo = await tx.workOrder.findFirst({ where: { id, operatorId: ctx.organizationId }, include: { parts: true, station: true } });
  if (!wo) throw notFound("Ordem de serviço não encontrada.");
  if (!ACTIVE.includes(wo.status)) throw new AppError("CONFLICT", "Ordem de serviço já concluída ou cancelada.");
  return wo;
}

export async function updateWorkOrder(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = z
    .object({
      workOrderId: z.string(),
      status: z.enum(["OPEN", "SCHEDULED", "IN_PROGRESS"]),
      diagnosis: z.string().trim().max(3000).optional(),
      technicianName: z.string().trim().max(120).optional(),
      scheduledFor: z.coerce.date().optional(),
    })
    .refine((x) => x.status !== "SCHEDULED" || x.scheduledFor, { message: "Informe a data do agendamento.", path: ["scheduledFor"] })
    .parse(raw);
  await db.$transaction(async (tx) => {
    const wo = await loadActive(tx, ctx, d.workOrderId);
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { status: d.status, diagnosis: d.diagnosis, technicianName: d.technicianName, scheduledFor: d.scheduledFor ?? wo.scheduledFor, startedAt: d.status === "IN_PROGRESS" ? wo.startedAt ?? new Date() : wo.startedAt },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "work_order.updated", entityType: "WorkOrder", entityId: wo.id, data: { from: wo.status, to: d.status } }, tx);
  });
}

export async function setChecklist(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = z.object({ workOrderId: z.string(), items: z.array(z.object({ item: z.string().trim().min(2).max(200), done: z.boolean() })).max(40) }).parse(raw);
  await db.$transaction(async (tx) => {
    const wo = await loadActive(tx, ctx, d.workOrderId);
    await tx.workOrder.update({ where: { id: wo.id }, data: { checklist: d.items } });
  });
}

export async function addPart(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = z.object({ workOrderId: z.string(), description: z.string().trim().min(2).max(200), quantity: z.coerce.number().gt(0).max(10000), unitCost: z.coerce.number().min(0).max(1e8) }).parse(raw);
  await db.$transaction(async (tx) => {
    const wo = await loadActive(tx, ctx, d.workOrderId);
    const qty = r2(d.quantity);
    const unit = r2(d.unitCost);
    await tx.workOrderPart.create({ data: { workOrderId: wo.id, description: d.description, quantity: qty.toFixed(2), unitCost: unit.toFixed(2), total: r2(qty.times(unit)).toFixed(2) } });
  });
}

export function workOrderCost(wo: { laborCost: Decimal.Value | { toString(): string }; parts: { total: { toString(): string } }[] }) {
  const parts = wo.parts.reduce((a, p) => a.plus(p.total.toString()), new Decimal(0));
  return { parts: parts.toFixed(2), labor: new Decimal(wo.laborCost.toString()).toFixed(2), total: parts.plus(wo.laborCost.toString()).toFixed(2) };
}

export async function completeWorkOrder(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = z.object({ workOrderId: z.string(), completionNotes: z.string().trim().min(10, "Descreva o serviço executado (mín. 10 caracteres).").max(5000), laborCost: z.coerce.number().min(0).max(1e8).default(0) }).parse(raw);
  await db.$transaction(async (tx) => {
    const wo = await loadActive(tx, ctx, d.workOrderId);
    const pending = (wo.checklist as ChecklistItem[]).filter((i) => !i.done);
    if (pending.length) throw new AppError("VALIDATION", `Checklist incompleto: ${pending.map((i) => i.item).join(", ")}.`);
    const evidence = await tx.attachment.count({ where: { entityType: "WorkOrder", entityId: wo.id, deletedAt: null } });
    if (!evidence) throw new AppError("VALIDATION", "Anexe ao menos uma evidência (foto ou laudo) antes de concluir.");
    const now = new Date();
    const labor = r2(d.laborCost);
    const cost = workOrderCost({ laborCost: labor, parts: wo.parts });
    await tx.workOrder.update({ where: { id: wo.id }, data: { status: "COMPLETED", completedAt: now, completionNotes: d.completionNotes, laborCost: labor.toFixed(2), startedAt: wo.startedAt ?? now } });
    if (new Decimal(cost.total).gt(0)) {
      const competence = periodOf(now);
      await lockOpenPeriod(tx, ctx.organizationId, competence);
      await tx.financialEntry.create({
        data: {
          operatorId: ctx.organizationId, kind: "PAYABLE", category: "MAINTENANCE", source: "WORK_ORDER", description: `${wo.number} — ${wo.title}`,
          amount: cost.total, competence, siteId: wo.station.siteId, stationId: wo.stationId, workOrderId: wo.id, createdById: ctx.userId,
        },
      });
    }
    if (wo.ticketId) await tx.ticketEvent.create({ data: { ticketId: wo.ticketId, kind: "WORK_ORDER", authorId: ctx.userId, body: `${wo.number} concluída: ${d.completionNotes}`, data: { workOrderId: wo.id, cost } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "work_order.completed", entityType: "WorkOrder", entityId: wo.id, data: { cost } }, tx);
  });
}

export async function cancelWorkOrder(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = z.object({ workOrderId: z.string(), reason: z.string().trim().min(5, "Informe o motivo.").max(500) }).parse(raw);
  await db.$transaction(async (tx) => {
    const wo = await loadActive(tx, ctx, d.workOrderId);
    await tx.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED", completionNotes: `Cancelada: ${d.reason}` } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "work_order.cancelled", entityType: "WorkOrder", entityId: wo.id, data: { reason: d.reason } }, tx);
  });
}

export async function listWorkOrders(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "maintenance:read");
  requireOperator(ctx);
  const f = z.object({ status: z.enum(["active", "done", "all"]).default("active") }).parse(raw);
  return db.workOrder.findMany({
    where: { operatorId: ctx.organizationId, ...(f.status === "active" ? { status: { in: ACTIVE } } : f.status === "done" ? { status: { notIn: ACTIVE } } : {}) },
    include: { station: { select: { ocppIdentity: true, site: { select: { name: true } } } }, parts: { select: { total: true } }, ticket: { select: { number: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getWorkOrder(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "maintenance:read");
  requireOperator(ctx);
  const wo = await db.workOrder.findFirst({
    where: { id, operatorId: ctx.organizationId },
    include: { station: { select: { id: true, ocppIdentity: true, site: { select: { name: true } } } }, parts: { orderBy: { createdAt: "asc" } }, ticket: { select: { id: true, number: true, title: true } }, plan: { select: { name: true } } },
  });
  if (!wo) throw notFound("Ordem de serviço não encontrada.");
  const entry = await db.financialEntry.findUnique({ where: { workOrderId: wo.id }, select: { id: true, amount: true, status: true, competence: true } });
  return { ...wo, checklist: wo.checklist as ChecklistItem[], cost: workOrderCost(wo), entry };
}

// ── Preventiva ──

export const planSchema = z
  .object({
    stationId: z.string().min(1),
    name: z.string().trim().min(3).max(120),
    trigger: z.enum(["TIME", "ENERGY_KWH", "SESSIONS"]),
    intervalDays: z.coerce.number().int().min(1).max(3650).optional(),
    intervalKwh: z.coerce.number().int().min(1).max(10_000_000).optional(),
    intervalSessions: z.coerce.number().int().min(1).max(1_000_000).optional(),
    checklist: z.array(z.string().trim().min(2).max(200)).min(1, "Inclua ao menos um item de checklist.").max(40),
  })
  .refine((p) => (p.trigger === "TIME" ? p.intervalDays : p.trigger === "ENERGY_KWH" ? p.intervalKwh : p.intervalSessions), { message: "Informe o intervalo do gatilho escolhido.", path: ["trigger"] });

export async function createPlan(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const d = planSchema.parse(raw);
  if (!(await db.chargingStation.findFirst({ where: { id: d.stationId, operatorId: ctx.organizationId, deletedAt: null } }))) throw notFound("Estação não encontrada.");
  const p = await db.maintenancePlan.create({ data: { ...d, operatorId: ctx.organizationId, createdById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "maintenance.plan_created", entityType: "MaintenancePlan", entityId: p.id, data: { trigger: d.trigger } });
  return p;
}

export async function setPlanActive(ctx: AuthContext | null, planId: string, active: boolean) {
  requirePermission(ctx, "maintenance:write");
  requireOperator(ctx);
  const r = await db.maintenancePlan.updateMany({ where: { id: planId, operatorId: ctx.organizationId }, data: { active } });
  if (r.count !== 1) throw notFound();
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: active ? "maintenance.plan_enabled" : "maintenance.plan_disabled", entityType: "MaintenancePlan", entityId: planId });
}

/** Uso desde a última preventiva concluída, apenas com telemetria de produção confiável. */
async function usageSince(plan: { id: string; createdAt: Date; station: { id: string; environment: string; connectionState: string } }): Promise<UsageSince> {
  const last = await db.workOrder.findFirst({ where: { planId: plan.id, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } });
  const since = last?.completedAt ?? plan.createdAt;
  const reasons: string[] = [];
  if (plan.station.environment !== "PRODUCTION") reasons.push("estação não é de produção");
  if (plan.station.connectionState === "NEVER_CONNECTED") reasons.push("estação nunca comunicou");
  const sessions = await db.chargingSession.findMany({ where: { stationId: plan.station.id, startedAt: { gte: since }, environment: "PRODUCTION" }, select: { status: true, meterStartWh: true, meterStopWh: true, lastMeterWh: true } });
  if (sessions.some((s) => s.status === "COMMUNICATION_LOST")) reasons.push("há sessões com comunicação perdida no intervalo");
  const done = sessions.filter((s) => s.status === "COMPLETED");
  return { since, kwh: done.reduce((a, s) => a + sessionEnergyWh(s), 0) / 1000, sessions: done.length, reliable: reasons.length === 0, unreliableReason: reasons.join("; ") };
}

export async function listPlans(ctx: AuthContext | null) {
  requirePermission(ctx, "maintenance:read");
  requireOperator(ctx);
  const plans = await db.maintenancePlan.findMany({
    where: { operatorId: ctx.organizationId },
    include: { station: { select: { id: true, ocppIdentity: true, environment: true, connectionState: true } }, workOrders: { where: { status: { in: ACTIVE } }, select: { id: true, number: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(plans.map(async (p) => ({ ...p, due: planDue(p, await usageSince(p)) })));
}

/** Gera OS preventiva para planos vencidos. Índice único parcial impede duas OS abertas por plano. */
export async function runPreventive(operatorId: string, now = new Date()) {
  const plans = await db.maintenancePlan.findMany({
    where: { operatorId, active: true, station: { deletedAt: null } },
    include: { station: { select: { id: true, environment: true, connectionState: true } }, workOrders: { where: { status: { in: ACTIVE } }, select: { id: true } } },
  });
  let created = 0;
  for (const p of plans) {
    if (p.workOrders.length) continue;
    const due = planDue(p, await usageSince(p), now);
    if (!due.due) continue;
    try {
      await db.$transaction((tx) => createWorkOrderTx(tx, operatorId, { stationId: p.stationId, title: `Preventiva: ${p.name}`, type: "PREVENTIVE", planId: p.id, diagnosis: due.reason, checklist: p.checklist, createdById: p.createdById }));
      created++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return created;
}
