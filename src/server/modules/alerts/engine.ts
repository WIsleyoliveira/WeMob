/**
 * Avaliação de regras de alerta. Para cada regra habilitada:
 *  - condição presente e alerta não resolvido com a mesma chave → atualiza "visto por último";
 *  - condição presente e alerta resolvido há menos que o "cooldown" → REABRE (sem nova notificação);
 *  - condição nova → cria alerta (índice único parcial impede duplicata concorrente), abre ticket
 *    se configurado e enfileira notificações;
 *  - condição ausente e alerta auto-resolvível → resolve.
 * Escalonamento: alerta aberto (não reconhecido) além do prazo → uma única vez.
 */
import Decimal from "decimal.js";
import { Prisma, type AlertKind, type AlertRule, type NotificationChannel, type StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { connectorTimeShares, isStationFresh, type ConnectorStatus } from "@/domain/stations/status";
import { createTicketTx } from "@/server/modules/support/tickets";
import { PARAM_SCHEMAS } from "./rules";
import { enqueueAlertNotifications } from "./notifications";
import type { ChannelAdapter } from "@/server/integrations/notify";

export interface Candidate {
  dedupeKey: string;
  title: string;
  detail: string;
  stationId?: string;
  autoResolve: boolean;
}

const ABNORMAL_STOP = ["EmergencyStop", "PowerLoss", "Reboot", "HardReset", "SoftReset", "Other"];

async function detect(rule: AlertRule, now: Date): Promise<Candidate[]> {
  const envs: StationEnvironment[] = rule.includeNonProduction ? ["PRODUCTION", "TEST", "SIMULATED"] : ["PRODUCTION"];
  const stationWhere = { operatorId: rule.operatorId, deletedAt: null, environment: { in: envs } };
  switch (rule.kind) {
    case "STATION_OFFLINE": {
      const p = PARAM_SCHEMAS.STATION_OFFLINE.parse(rule.params);
      const stations = await db.chargingStation.findMany({ where: { ...stationWhere, connectionState: { not: "NEVER_CONNECTED" } } });
      return stations
        .filter((s) => !isStationFresh(s, now) && (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > 2 * s.heartbeatInterval * 1000 + 60_000 + p.minutes * 60_000))
        .map((s) => ({ dedupeKey: `offline:${s.id}`, title: `${s.ocppIdentity} sem comunicação`, detail: `Última mensagem: ${s.lastSeenAt?.toISOString() ?? "—"} (relógio do servidor).`, stationId: s.id, autoResolve: true }));
    }
    case "REPEATED_FAULTS": {
      const p = PARAM_SCHEMAS.REPEATED_FAULTS.parse(rule.params);
      const since = new Date(now.getTime() - p.windowMinutes * 60_000);
      const groups = await db.connectorStatusEvent.groupBy({ by: ["connectorPk"], where: { status: "FAULTED", receivedAt: { gte: since }, connector: { station: stationWhere } }, _count: true });
      const hits = groups.filter((g) => g._count >= p.count);
      if (!hits.length) return [];
      const conns = await db.connector.findMany({ where: { id: { in: hits.map((h) => h.connectorPk) } }, include: { station: true } });
      return hits.map((h) => {
        const c = conns.find((x) => x.id === h.connectorPk)!;
        return { dedupeKey: `faults:${c.id}`, title: `${c.station.ocppIdentity} conector ${c.connectorId}: ${h._count} falhas`, detail: `${h._count} status "Em falha" em ${p.windowMinutes} min (último código: ${c.errorCode ?? "—"}).`, stationId: c.stationId, autoResolve: true };
      });
    }
    case "AVAILABILITY_DROP": {
      const p = PARAM_SCHEMAS.AVAILABILITY_DROP.parse(rule.params);
      const from = new Date(now.getTime() - p.windowHours * 3600_000);
      const stations = await db.chargingStation.findMany({ where: { ...stationWhere, connectionState: { not: "NEVER_CONNECTED" } }, include: { connectors: true } });
      const out: Candidate[] = [];
      for (const s of stations) {
        // Sem comunicação é tratado pela regra de offline: evita dois alertas para a mesma causa.
        if (!s.connectors.length || !isStationFresh(s, now)) continue;
        const shares = await Promise.all(
          s.connectors.map(async (c) => {
            const [events, before] = await Promise.all([
              db.connectorStatusEvent.findMany({ where: { connectorPk: c.id, applied: true, receivedAt: { gt: from, lt: now } }, select: { status: true, receivedAt: true } }),
              db.connectorStatusEvent.findFirst({ where: { connectorPk: c.id, applied: true, receivedAt: { lte: from } }, orderBy: { receivedAt: "desc" }, select: { status: true } }),
            ]);
            return connectorTimeShares(events.map((e) => ({ status: e.status as ConnectorStatus, at: e.receivedAt })), from, now, (before?.status as ConnectorStatus) ?? "UNKNOWN").availability;
          }),
        );
        const avg = shares.reduce((a, x) => a + x, 0) / shares.length;
        if (avg < p.minAvailability)
          out.push({ dedupeKey: `availability:${s.id}`, title: `${s.ocppIdentity}: disponibilidade ${(avg * 100).toFixed(1)}%`, detail: `Média dos conectores nas últimas ${p.windowHours} h abaixo do mínimo de ${(p.minAvailability * 100).toFixed(0)}%.`, stationId: s.id, autoResolve: true });
      }
      return out;
    }
    case "SESSION_INTERRUPTED": {
      const p = PARAM_SCHEMAS.SESSION_INTERRUPTED.parse(rule.params);
      const since = new Date(now.getTime() - p.windowHours * 3600_000);
      const [lost, stopped] = await Promise.all([
        db.chargingSession.findMany({ where: { status: "COMMUNICATION_LOST", environment: { in: envs }, station: { operatorId: rule.operatorId } }, include: { station: true } }),
        db.chargingSession.findMany({ where: { status: "COMPLETED", stoppedAt: { gte: since }, stopReason: { in: ABNORMAL_STOP }, environment: { in: envs }, station: { operatorId: rule.operatorId } }, include: { station: true } }),
      ]);
      return [
        ...lost.map((x) => ({ dedupeKey: `session-lost:${x.id}`, title: `Sessão #${x.transactionId} (${x.station.ocppIdentity}) sem comunicação`, detail: "Valores parciais; aguardando StopTransaction do carregador.", stationId: x.stationId, autoResolve: true })),
        ...stopped.map((x) => ({ dedupeKey: `session-stop:${x.id}`, title: `Sessão #${x.transactionId} (${x.station.ocppIdentity}) interrompida: ${x.stopReason}`, detail: `Encerrada em ${x.stoppedAt?.toISOString()} por ${x.stopReason}. Verifique o equipamento e o atendimento ao motorista.`, stationId: x.stationId, autoResolve: false })),
      ];
    }
    case "PAYMENT_DIVERGENCE": {
      const p = PARAM_SCHEMAS.PAYMENT_DIVERGENCE.parse(rule.params);
      const stationIds = (await db.chargingStation.findMany({ where: { operatorId: rule.operatorId }, select: { id: true } })).map((s) => s.id);
      const scope: Prisma.PaymentWhereInput = {
        environment: { in: rule.includeNonProduction ? ["PRODUCTION", "SANDBOX"] : ["PRODUCTION"] },
        OR: [{ session: { stationId: { in: stationIds } } }, { chargeRequest: { stationId: { in: stationIds } } }],
      };
      const sessionScope: Prisma.ChargingSessionWhereInput = { stationId: { in: stationIds }, environment: { in: rule.includeNonProduction ? ["PRODUCTION", "TEST"] : ["PRODUCTION"] } };
      const live = { ...sessionScope, status: { in: ["ACTIVE", "COMMUNICATION_LOST"] as ("ACTIVE" | "COMMUNICATION_LOST")[] }, limitAmount: { not: null } };
      const [stale, orphan, settled, stopUnconfirmed, nearLimit, funded, unprocessed, scheduled, review] = await Promise.all([
        db.payment.findMany({ where: { ...scope, status: "AUTHORIZED", createdAt: { lt: new Date(now.getTime() - p.staleAuthorizationHours * 3600_000) } } }),
        db.payment.findMany({ where: { ...scope, status: { in: ["AUTHORIZED", "CAPTURED"] }, sessionId: null, createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } } }),
        db.payment.findMany({ where: { ...scope, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] }, session: { amount: { not: null } } }, include: { session: true } }),
        // Limite atingido, parada pedida e o carregador ainda não encerrou (comando não entregue, recusado ou ignorado).
        db.chargingSession.findMany({ where: { ...live, limitStopRequestedAt: { lt: new Date(now.getTime() - 3 * 60_000) } }, include: { station: true } }),
        db.chargingSession.findMany({ where: { ...live, limitWarnedAt: { not: null }, limitStopRequestedAt: null }, include: { station: true } }),
        db.chargingSession.findMany({ where: { ...live, startedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, include: { station: true, measurements: { orderBy: { timestamp: "desc" }, take: 1, select: { timestamp: true } } } }),
        db.paymentEvent.findMany({ where: { processedAt: null, receivedAt: { lt: new Date(now.getTime() - 30 * 60_000) }, payment: scope }, select: { id: true, type: true, paymentId: true, attempts: true, outcome: true } }),
        db.refund.findMany({ where: { status: "SCHEDULED", nextAttemptAt: { lt: new Date(now.getTime() - 3600_000) }, payment: scope }, select: { id: true, amount: true, paymentId: true, nextAttemptAt: true, lastError: true } }),
        db.payment.findMany({ where: { ...scope, reviewOpenedAt: { not: null }, reviewResolvedAt: null }, select: { id: true, reviewReason: true, reviewOpenedAt: true } }),
      ]);
      const commands = await db.remoteCommand.findMany({ where: { id: { in: stopUnconfirmed.map((x) => x.limitStopCommandId).filter((x): x is string => !!x) } }, select: { id: true, status: true } });
      const commandStatus = new Map(commands.map((c) => [c.id, c.status]));
      return [
        ...stopUnconfirmed.map((x) => ({
          dedupeKey: `session-limit-stop:${x.id}`,
          title: `Limite financeiro atingido e parada NÃO confirmada: sessão #${x.transactionId} (${x.station.ocppIdentity})`,
          detail: `Limite R$ ${x.limitAmount} (cobertura R$ ${x.fundedAmount}); parada pedida em ${x.limitStopRequestedAt!.toISOString()}, comando ${commandStatus.get(x.limitStopCommandId ?? "") ?? "não criado"}. Contingência: parar a recarga no equipamento/painel do fabricante e acompanhar o excedente (análise).`,
          stationId: x.stationId,
          autoResolve: true,
        })),
        ...nearLimit.map((x) => ({ dedupeKey: `session-limit-near:${x.id}`, title: `Sessão #${x.transactionId} (${x.station.ocppIdentity}) perto do limite financeiro`, detail: `Limite R$ ${x.limitAmount}; a parada remota é pedida automaticamente ao atingir o limite.`, stationId: x.stationId, autoResolve: true })),
        ...funded
          .filter((x) => !x.measurements[0] || now.getTime() - x.measurements[0].timestamp.getTime() > 15 * 60_000)
          .map((x) => ({ dedupeKey: `session-telemetry:${x.id}`, title: `Sessão #${x.transactionId} (${x.station.ocppIdentity}) sem leitura do medidor há mais de 15 min`, detail: `Sem MeterValues o consumo não é acompanhado e o limite financeiro (R$ ${x.limitAmount}) só é verificado pelo tempo. Verificar a configuração de MeterValues do carregador.`, stationId: x.stationId, autoResolve: true })),
        ...unprocessed.map((x) => ({ dedupeKey: `webhook:${x.id}`, title: `Evento de pagamento ${x.type} não processado há mais de 30 min`, detail: `Pagamento ${x.paymentId ?? "—"}, ${x.attempts} tentativa(s). Último resultado: ${x.outcome ?? "—"}.`, autoResolve: true })),
        ...scheduled.map((x) => ({ dedupeKey: `refund-overdue:${x.id}`, title: `Estorno de R$ ${x.amount} agendado e não reprocessado`, detail: `Previsto para ${x.nextAttemptAt!.toISOString()} (pagamento ${x.paymentId}). Verificar se o servidor OCPP (ciclo de automações) está rodando. Último retorno: ${x.lastError ?? "—"}.`, autoResolve: true })),
        ...review.map((x) => ({ dedupeKey: `payment:${x.id}:review`, title: "Pagamento em análise", detail: `${x.reviewReason ?? "—"} (desde ${x.reviewOpenedAt!.toISOString()}).`, autoResolve: true })),
        ...stale.map((x) => ({ dedupeKey: `payment:${x.id}:stale`, title: `Autorização pendente há mais de ${p.staleAuthorizationHours} h`, detail: `Pagamento ${x.id} (${x.amountAuthorized} reservado) sem captura nem cancelamento.`, autoResolve: true })),
        ...orphan.map((x) => ({ dedupeKey: `payment:${x.id}:orphan`, title: "Pagamento sem sessão de recarga", detail: `Pagamento ${x.id} (${x.status}) sem sessão vinculada.`, autoResolve: true })),
        ...settled
          .filter((x) => !new Decimal(x.amountCaptured.toString()).eq(x.session!.amount!.toString()))
          .map((x) => ({ dedupeKey: `payment:${x.id}:amount`, title: "Valor capturado diferente do apurado", detail: `Capturado ${x.amountCaptured} × apurado ${x.session!.amount} (sessão ${x.sessionId}).`, stationId: x.session!.stationId, autoResolve: true })),
      ];
    }
  }
}

export async function evaluateAlerts(operatorId: string, now = new Date(), adapters?: Record<NotificationChannel, ChannelAdapter>) {
  const rules = await db.alertRule.findMany({ where: { operatorId, enabled: true } });
  const stats = { evaluated: rules.length, created: 0, reopened: 0, resolved: 0, escalated: 0, ticketsCreated: 0 };
  for (const rule of rules) {
    const candidates = await detect(rule, now);
    const keys = new Set(candidates.map((c) => c.dedupeKey));
    const unresolved = await db.alert.findMany({ where: { operatorId, ruleId: rule.id, status: { not: "RESOLVED" } } });
    const byKey = new Map(unresolved.map((a) => [a.dedupeKey, a]));
    for (const c of candidates) {
      const existing = byKey.get(c.dedupeKey);
      if (existing) {
        await db.alert.update({ where: { id: existing.id }, data: { lastSeenAt: now, detail: c.detail } });
        continue;
      }
      const previous = await db.alert.findFirst({ where: { operatorId, dedupeKey: c.dedupeKey, status: "RESOLVED" }, orderBy: { resolvedAt: "desc" } });
      if (previous && !c.autoResolve) continue; // ocorrência pontual já tratada manualmente
      if (previous?.resolvedAt && now.getTime() - previous.resolvedAt.getTime() < rule.cooldownMinutes * 60_000) {
        await db.alert.update({ where: { id: previous.id }, data: { status: "OPEN", resolvedAt: null, resolvedReason: null, acknowledgedAt: null, lastSeenAt: now, occurrences: { increment: 1 } } });
        stats.reopened++;
        continue;
      }
      try {
        await db.$transaction(async (tx) => {
          const alert = await tx.alert.create({
            data: { operatorId, ruleId: rule.id, kind: rule.kind, severity: rule.severity, dedupeKey: c.dedupeKey, title: c.title, detail: c.detail, stationId: c.stationId, autoResolve: c.autoResolve, firstSeenAt: now, lastSeenAt: now },
          });
          if (rule.createTicket) {
            const ticket = await createTicketTx(tx, {
              operatorId, title: c.title.slice(0, 160), description: `${c.detail}\n\nAberto automaticamente pela regra "${rule.name}".`, category: rule.kind === "PAYMENT_DIVERGENCE" ? "PAYMENT" : rule.kind === "STATION_OFFLINE" ? "CONNECTIVITY" : "CHARGER_FAULT",
              priority: rule.ticketPriority, origin: "ALERT", stationId: c.stationId ?? null,
            });
            await tx.alert.update({ where: { id: alert.id }, data: { ticketId: ticket.id } });
            await tx.ticketEvent.create({ data: { ticketId: ticket.id, kind: "ALERT", body: c.title, data: { alertId: alert.id } } });
            stats.ticketsCreated++;
          }
          await enqueueAlertNotifications(tx, alert, rule, "opened", adapters);
        });
        stats.created++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // outra avaliação criou o mesmo alerta
      }
    }
    for (const a of unresolved) {
      if (!keys.has(a.dedupeKey) && a.autoResolve) {
        await db.alert.updateMany({ where: { id: a.id, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: now, resolvedReason: "Condição normalizada (automático)." } });
        stats.resolved++;
      }
    }
    if (rule.escalateAfterMinutes) {
      const toEscalate = await db.alert.findMany({ where: { ruleId: rule.id, status: "OPEN", escalatedAt: null, firstSeenAt: { lt: new Date(now.getTime() - rule.escalateAfterMinutes * 60_000) } } });
      for (const a of toEscalate) {
        await db.$transaction(async (tx) => {
          const r = await tx.alert.updateMany({ where: { id: a.id, escalatedAt: null }, data: { escalatedAt: now } });
          if (r.count !== 1) return;
          if (a.ticketId) {
            await tx.ticket.update({ where: { id: a.ticketId }, data: { priority: "CRITICAL" } });
            await tx.ticketEvent.create({ data: { ticketId: a.ticketId, kind: "PRIORITY_CHANGE", body: "Escalonado automaticamente: alerta sem reconhecimento no prazo.", data: { to: "CRITICAL" } } });
          }
          await enqueueAlertNotifications(tx, a, rule, "escalated", adapters);
          stats.escalated++;
        });
      }
    }
  }
  return stats;
}

export const ALERT_STATUS_LABEL = { OPEN: "Aberto", ACKNOWLEDGED: "Reconhecido", RESOLVED: "Resolvido" } as const;

export async function listAlerts(ctx: AuthContext | null, raw: { status?: "open" | "all" } = {}) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  return db.alert.findMany({
    where: { operatorId: ctx.organizationId, ...(raw.status === "all" ? {} : { status: { not: "RESOLVED" } }) },
    include: { station: { select: { id: true, ocppIdentity: true } }, ticket: { select: { id: true, number: true } } },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
    take: 200,
  });
}

export async function acknowledgeAlert(ctx: AuthContext | null, alertId: string) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  const r = await db.alert.updateMany({ where: { id: alertId, operatorId: ctx.organizationId, status: "OPEN" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: ctx.userId } });
  if (r.count !== 1) throw new AppError("CONFLICT", "Alerta inexistente ou não está aberto.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "alert.acknowledged", entityType: "Alert", entityId: alertId });
}

export async function resolveAlert(ctx: AuthContext | null, alertId: string, reason: string) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  if (!reason || reason.trim().length < 5) throw new AppError("VALIDATION", "Informe como foi resolvido.");
  const a = await db.alert.findFirst({ where: { id: alertId, operatorId: ctx.organizationId } });
  if (!a) throw notFound();
  const r = await db.alert.updateMany({ where: { id: a.id, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedReason: reason.trim().slice(0, 500) } });
  if (r.count !== 1) throw new AppError("CONFLICT", "Alerta já resolvido.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "alert.resolved", entityType: "Alert", entityId: a.id, data: { reason } });
}

export type { AlertKind };
