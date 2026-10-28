/**
 * Ciclo de automações operacionais (executado pelo processo do servidor OCPP a cada minuto e
 * sob demanda pela tela de alertas). Cada tarefa é registrada em AutomationRun com início, fim,
 * resultado ou erro e número da tentativa (falhas consecutivas); a falha de uma tarefa não
 * impede as demais e a próxima execução do ciclo é a nova tentativa.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { evaluateAlerts } from "@/server/modules/alerts/engine";
import { dispatchNotifications } from "@/server/modules/alerts/notifications";
import { runPreventive } from "@/server/modules/maintenance/service";
import { importDriverSupportRequests } from "@/server/modules/support/tickets";
import { reconcileAutomatically } from "@/server/payments/service";

export async function runJob<T>(job: string, operatorId: string | null, fn: () => Promise<T>) {
  const lastRuns = await db.automationRun.findMany({ where: { job, operatorId }, orderBy: { startedAt: "desc" }, take: 20, select: { status: true } });
  const consecutiveFailures = lastRuns.findIndex((r) => r.status !== "FAILED");
  const attempt = (consecutiveFailures === -1 ? lastRuns.length : consecutiveFailures) + 1;
  const run = await db.automationRun.create({ data: { job, operatorId, status: "RUNNING", attempt } });
  try {
    const stats = await fn();
    await db.automationRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stats: stats as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
    return { ok: true as const, stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.automationRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error.slice(0, 1000), finishedAt: new Date() } });
    log.error("automation_failed", { job, operatorId, attempt, error });
    return { ok: false as const, error };
  }
}

export async function runOperationsCycle(now = new Date()) {
  const operators = await db.organization.findMany({ where: { kind: "OPERATOR", deletedAt: null }, select: { id: true } });
  for (const op of operators) {
    await runJob("alerts.evaluate", op.id, () => evaluateAlerts(op.id, now));
    await runJob("maintenance.preventive", op.id, () => runPreventive(op.id, now).then((created) => ({ created })));
    await runJob("support.import_driver_requests", op.id, () => importDriverSupportRequests(op.id).then((created) => ({ created })));
    // Conciliação com o gateway: no máximo 1×/h por operadora (consulta autenticada com limite por execução).
    // Após falha (ex.: gateway fora do ar), nova tentativa em 15 min — nunca a cada minuto.
    const lastRecon = await db.automationRun.findFirst({ where: { job: "payments.reconcile", operatorId: op.id }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } });
    const wait = lastRecon?.status === "FAILED" ? 15 * 60_000 : 3600_000;
    if (!lastRecon || now.getTime() - lastRecon.startedAt.getTime() >= wait) await runJob("payments.reconcile", op.id, () => reconcileAutomatically(op.id, now));
  }
  await runJob("notifications.dispatch", null, () => dispatchNotifications(now));
}

/** Execução manual (tela de alertas), restrita à operadora da sessão. */
export async function runOperationsNow(ctx: AuthContext | null) {
  requirePermission(ctx, "alert:configure");
  requireOperator(ctx);
  const now = new Date();
  const alerts = await runJob("alerts.evaluate", ctx.organizationId, () => evaluateAlerts(ctx.organizationId, now));
  const preventive = await runJob("maintenance.preventive", ctx.organizationId, () => runPreventive(ctx.organizationId, now).then((created) => ({ created })));
  const notifications = await runJob("notifications.dispatch", ctx.organizationId, () => dispatchNotifications(now, undefined, ctx.organizationId));
  return { alerts, preventive, notifications };
}

export async function listAutomationRuns(ctx: AuthContext | null) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  return db.automationRun.findMany({ where: { OR: [{ operatorId: ctx.organizationId }, { operatorId: null }] }, orderBy: { startedAt: "desc" }, take: 30 });
}
