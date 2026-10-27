/**
 * Outbox de notificações: só para destinatários que deram consentimento (opt-in próprio, revogável)
 * e só por adaptador configurado. dedupeKey único por (alerta, fase, canal, destinatário) impede
 * duplicidade e laços; falhas são retentadas com espera exponencial até o limite de tentativas.
 * Falhas de notificação NUNCA geram novos alertas.
 */
import { z } from "zod";
import type { Alert, AlertRule, NotificationChannel, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { log } from "@/server/log";
import { AppError } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { CHANNEL_LABEL, defaultChannelAdapters, type ChannelAdapter } from "@/server/integrations/notify";

type Tx = Prisma.TransactionClient;
export type Phase = "opened" | "escalated";

/** Usuários da operadora com alert:read e consentimento ativo no canal. */
async function consentingRecipients(tx: Tx, operatorId: string, channel: NotificationChannel) {
  const rows = await tx.notificationRecipient.findMany({ where: { organizationId: operatorId, channel, revokedAt: null } });
  if (!rows.length) return [];
  const members = await tx.membership.findMany({ where: { organizationId: operatorId, userId: { in: rows.map((r) => r.userId) }, revokedAt: null, user: { disabledAt: null } }, include: { role: true } });
  const allowed = new Set(members.filter((m) => m.role.permissions.includes("alert:read")).map((m) => m.userId));
  return rows.filter((r) => allowed.has(r.userId));
}

export async function enqueueAlertNotifications(tx: Tx, alert: Alert, rule: AlertRule, phase: Phase, adapters = defaultChannelAdapters()) {
  const subject = `${phase === "escalated" ? "[ESCALONADO] " : ""}[${alert.severity === "CRITICAL" ? "CRÍTICO" : "ATENÇÃO"}] ${alert.title}`;
  for (const channel of rule.notifyChannels) {
    const base = { operatorId: alert.operatorId, alertId: alert.id, channel, subject, body: alert.detail };
    if (adapters[channel].status !== "configured") {
      await tx.notification.createMany({ data: [{ ...base, status: "SKIPPED_NOT_CONFIGURED", lastError: `${CHANNEL_LABEL[channel]} não configurado.`, dedupeKey: `${alert.id}:${phase}:${channel}:not-configured` }], skipDuplicates: true });
      continue;
    }
    const recipients = await consentingRecipients(tx, alert.operatorId, channel);
    if (!recipients.length) {
      await tx.notification.createMany({ data: [{ ...base, status: "SKIPPED_NO_CONSENT", lastError: "Nenhum destinatário com consentimento ativo neste canal.", dedupeKey: `${alert.id}:${phase}:${channel}:no-consent` }], skipDuplicates: true });
      continue;
    }
    await tx.notification.createMany({
      data: recipients.map((r) => ({ ...base, recipientUserId: r.userId, destination: r.destination, status: "PENDING" as const, dedupeKey: `${alert.id}:${phase}:${channel}:${r.userId}` })),
      skipDuplicates: true,
    });
  }
}

/** Espera antes da tentativa n+1: 1, 2, 4, 8… minutos. */
export const backoffMs = (attempts: number) => 2 ** Math.max(0, attempts - 1) * 60_000;

export async function dispatchNotifications(now = new Date(), adapters: Record<NotificationChannel, ChannelAdapter> = defaultChannelAdapters(), operatorId?: string) {
  const due = await db.notification.findMany({ where: { status: "PENDING", ...(operatorId ? { operatorId } : {}), OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 50 });
  const stats = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  for (const n of due) {
    // Reivindica a linha (evita envio duplo por dois processos concorrentes).
    const claimed = await db.notification.updateMany({ where: { id: n.id, status: "PENDING", attempts: n.attempts }, data: { attempts: n.attempts + 1, nextAttemptAt: new Date(now.getTime() + 10 * 60_000) } });
    if (claimed.count !== 1) continue;
    const attempts = n.attempts + 1;
    const adapter = adapters[n.channel];
    if (adapter.status !== "configured" || !n.destination) {
      await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED_NOT_CONFIGURED", lastError: `${CHANNEL_LABEL[n.channel]} não configurado.`, nextAttemptAt: null } });
      stats.skipped++;
      continue;
    }
    let error: string | null = null;
    try {
      const r = await adapter.send({ to: n.destination, subject: n.subject, body: n.body });
      if (!r.delivered) error = r.reason ?? "não entregue";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (!error) {
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: now, lastError: null, nextAttemptAt: null } });
      stats.sent++;
    } else if (attempts >= n.maxAttempts) {
      await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", lastError: error.slice(0, 500), nextAttemptAt: null } });
      log.warn("notification_failed", { notificationId: n.id, channel: n.channel, attempts });
      stats.failed++;
    } else {
      await db.notification.update({ where: { id: n.id }, data: { lastError: error.slice(0, 500), nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) } });
      stats.retried++;
    }
  }
  return stats;
}

// ── Consentimento do próprio usuário ──

const destinationSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("EMAIL"), destination: z.string().trim().email("E-mail inválido.").max(200), consent: z.boolean() }),
  z.object({ channel: z.literal("SMS"), destination: z.string().trim().regex(/^\+[1-9]\d{9,14}$/, "Use o formato internacional, ex.: +5591999998888."), consent: z.boolean() }),
  z.object({ channel: z.literal("WHATSAPP"), destination: z.string().trim().regex(/^\+[1-9]\d{9,14}$/, "Use o formato internacional, ex.: +5591999998888."), consent: z.boolean() }),
]);

export async function setNotificationConsent(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  const d = destinationSchema.parse(raw);
  const key = { userId_organizationId_channel: { userId: ctx.userId, organizationId: ctx.organizationId, channel: d.channel } };
  if (d.consent) {
    await db.notificationRecipient.upsert({ where: key, create: { userId: ctx.userId, organizationId: ctx.organizationId, channel: d.channel, destination: d.destination, consentAt: new Date() }, update: { destination: d.destination, consentAt: new Date(), revokedAt: null } });
  } else {
    const r = await db.notificationRecipient.updateMany({ where: { userId: ctx.userId, organizationId: ctx.organizationId, channel: d.channel, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new AppError("VALIDATION", "Não há consentimento ativo neste canal.");
  }
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: d.consent ? "notification.consent_given" : "notification.consent_revoked", entityType: "NotificationRecipient", data: { channel: d.channel } });
}

export async function myNotificationConsents(ctx: AuthContext | null) {
  requirePermission(ctx, "alert:read");
  return db.notificationRecipient.findMany({ where: { userId: ctx.userId, organizationId: ctx.organizationId } });
}

export async function listNotifications(ctx: AuthContext | null) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  return db.notification.findMany({ where: { operatorId: ctx.organizationId }, select: { id: true, channel: true, subject: true, status: true, attempts: true, maxAttempts: true, lastError: true, sentAt: true, nextAttemptAt: true, createdAt: true, recipientUserId: true }, orderBy: { createdAt: "desc" }, take: 100 });
}
