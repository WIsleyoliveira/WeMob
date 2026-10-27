/**
 * Pagamentos: estado local sincronizado SOMENTE a partir do provedor (consulta ou webhook
 * verificado). Nenhuma confirmação vinda do navegador altera status.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { Prisma, type Payment, type PaymentStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { log } from "@/server/log";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { getProvider } from "./registry";
import type { ProviderPayment } from "./provider";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendente",
  AUTHORIZED: "Autorizado (valor reservado)",
  CAPTURED: "Capturado",
  PARTIALLY_REFUNDED: "Reembolsado parcialmente",
  REFUNDED: "Reembolsado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  DISPUTED: "Contestado",
};

/** Transições permitidas. Estado reportado fora desta tabela é tratado como evento atrasado e ignorado. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ["AUTHORIZED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["CAPTURED", "CANCELLED", "FAILED"],
  CAPTURED: ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  DISPUTED: ["CAPTURED", "REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus) {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}

type Listener = (payment: Payment) => Promise<void>;
const g = globalThis as unknown as { __paymentListeners?: Map<string, Listener> };
const listenerMap: Map<string, Listener> = (g.__paymentListeners ??= new Map<string, Listener>());
/**
 * O fluxo de recarga se registra aqui para reagir a autorização/falha (evita import circular).
 * Registro por chave: recarregamento de módulo (dev) substitui em vez de duplicar.
 */
export function onPaymentStateChange(key: string, l: Listener) {
  listenerMap.set(key, l);
}
const listeners = { [Symbol.iterator]: () => listenerMap.values() };

/** Aplica o estado informado pelo provedor, respeitando a máquina de estados. */
export async function applyProviderState(payment: Payment, p: ProviderPayment, source: string): Promise<{ applied: boolean; payment: Payment }> {
  const to = p.status as PaymentStatus;
  if (!canTransition(payment.status, to)) {
    log.warn("payment_transition_ignored", { paymentId: payment.id, from: payment.status, to, source });
    return { applied: false, payment };
  }
  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: to,
      amountAuthorized: p.amountAuthorized,
      amountCaptured: p.amountCaptured,
      amountRefunded: p.amountRefunded,
      ...(to !== payment.status || !new Decimal(payment.amountCaptured.toString()).eq(p.amountCaptured) ? { reconciledAt: null } : {}),
    },
  });
  if (updated.status !== payment.status) {
    await audit({ action: "payment.status_changed", entityType: "Payment", entityId: payment.id, data: { from: payment.status, to, source } });
    for (const l of listeners) await l(updated).catch((e) => log.error("payment_listener_failed", { error: String(e) }));
  }
  return { applied: true, payment: updated };
}

/**
 * Webhook: (1) verifica assinatura; (2) registra evento único por (provedor, id) — reentrega não
 * reprocessa; (3) consulta o provedor (fonte de verdade); (4) aplica a transição.
 * Retorna o status HTTP a devolver ao provedor (5xx → provedor tenta de novo).
 */
export async function processWebhook(providerName: string, rawBody: string, headers: Record<string, string | undefined>) {
  const provider = getProvider(providerName);
  let event;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (e) {
    log.warn("payment_webhook_rejected", { provider: providerName, reason: e instanceof Error ? e.message : String(e) });
    return { http: 401, outcome: "assinatura inválida" };
  }
  let row;
  try {
    row = await db.paymentEvent.create({
      data: { provider: providerName, eventId: event.eventId, type: event.type, signatureValid: true, payload: JSON.parse(rawBody) as Prisma.InputJsonValue },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    row = await db.paymentEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: providerName, eventId: event.eventId } } });
    if (row.processedAt) return { http: 200, outcome: "duplicado (já processado)" };
  }
  const payment = await db.payment.findUnique({ where: { provider_providerRef: { provider: providerName, providerRef: event.providerRef } } });
  if (!payment) {
    await db.paymentEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), outcome: "pagamento desconhecido (registrado para conciliação)", attempts: { increment: 1 } } });
    return { http: 200, outcome: "pagamento desconhecido" };
  }
  try {
    const truth = await provider.fetch(event.providerRef);
    const r = await applyProviderState(payment, truth, `webhook:${event.type}`);
    await db.paymentEvent.update({
      where: { id: row.id },
      data: { paymentId: payment.id, processedAt: new Date(), outcome: r.applied ? `aplicado: ${truth.status}` : `ignorado (fora de ordem): ${truth.status}`, attempts: { increment: 1 } },
    });
    return { http: 200, outcome: r.applied ? truth.status : "ignorado" };
  } catch (e) {
    await db.paymentEvent.update({ where: { id: row.id }, data: { paymentId: payment.id, outcome: `falha ao consultar provedor: ${e instanceof Error ? e.message : String(e)}`, attempts: { increment: 1 } } });
    return { http: 503, outcome: "falha ao consultar provedor" };
  }
}

/** Reprocessa eventos não concluídos (ex.: provedor indisponível no primeiro recebimento). */
export async function retryPendingWebhookEvents() {
  const pending = await db.paymentEvent.findMany({ where: { processedAt: null, signatureValid: true }, take: 100 });
  let done = 0;
  for (const ev of pending) {
    const payment = ev.paymentId ? await db.payment.findUnique({ where: { id: ev.paymentId } }) : null;
    if (!payment) continue;
    try {
      const truth = await getProvider(ev.provider).fetch(payment.providerRef);
      const r = await applyProviderState(payment, truth, `retry:${ev.type}`);
      await db.paymentEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), outcome: r.applied ? `aplicado na retentativa: ${truth.status}` : "ignorado na retentativa", attempts: { increment: 1 } } });
      done++;
    } catch {
      await db.paymentEvent.update({ where: { id: ev.id }, data: { attempts: { increment: 1 } } });
    }
  }
  return done;
}

export async function capturePayment(paymentId: string, amount: Decimal.Value) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status !== "AUTHORIZED") throw new AppError("CONFLICT", `Captura exige pagamento autorizado (atual: ${payment.status}).`);
  const value = Decimal.min(new Decimal(amount), new Decimal(payment.amountAuthorized.toString())).toFixed(2);
  const truth = await getProvider(payment.provider).capture(payment.providerRef, value);
  return (await applyProviderState(payment, truth, "capture")).payment;
}

export async function cancelPayment(paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!["PENDING", "AUTHORIZED"].includes(payment.status)) return payment;
  const truth = await getProvider(payment.provider).cancel(payment.providerRef);
  return (await applyProviderState(payment, truth, "cancel")).payment;
}

export const refundSchema = z.object({
  paymentId: z.string(),
  amount: z.coerce.number().gt(0),
  reason: z.string().trim().min(5, "Descreva o motivo.").max(500),
});

/** Reembolso: só sobre valor capturado ainda não reembolsado; confirmado pelo provedor. */
export async function requestRefund(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:refund");
  requireOperator(ctx);
  const d = refundSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"refund:" + d.paymentId}))`;
    const payment = await tx.payment.findFirst({ where: { id: d.paymentId, ...(await operatorPaymentScope(ctx.organizationId)) } });
    if (!payment) throw notFound("Pagamento não encontrado.");
    if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) throw new AppError("CONFLICT", "Só é possível reembolsar pagamento capturado.");
    const available = new Decimal(payment.amountCaptured.toString()).minus(payment.amountRefunded.toString());
    const amount = new Decimal(d.amount).toDecimalPlaces(2);
    if (amount.gt(available)) throw new AppError("VALIDATION", `Valor acima do disponível para reembolso (${available.toFixed(2)}).`);
    const refund = await tx.refund.create({ data: { paymentId: payment.id, amount: amount.toFixed(2), reason: d.reason, requestedById: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.refund_requested", entityType: "Payment", entityId: payment.id, data: { amount: amount.toFixed(2), reason: d.reason } }, tx);
    return { refund, payment };
  }).then(async ({ refund, payment }) => {
    try {
      const truth = await getProvider(payment.provider).refund(payment.providerRef, refund.amount.toString());
      await db.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", completedAt: new Date(), providerRef: truth.providerRef } });
      await applyProviderState(payment, truth, "refund");
    } catch (e) {
      await db.refund.update({ where: { id: refund.id }, data: { status: "FAILED", completedAt: new Date() } });
      throw new AppError("VALIDATION", `Reembolso não confirmado pelo provedor: ${e instanceof Error ? e.message : String(e)}`);
    }
    return refund;
  });
}

/**
 * Escopo multiempresa: pagamentos ligados (pela sessão ou pelo pedido de recarga) a estações da
 * operadora da sessão. Sem isso, outra operadora veria pagamentos da rede inteira.
 */
async function operatorPaymentScope(operatorId: string): Promise<Prisma.PaymentWhereInput> {
  const ids = (await db.chargingStation.findMany({ where: { operatorId }, select: { id: true } })).map((s) => s.id);
  return { OR: [{ session: { stationId: { in: ids } } }, { chargeRequest: { stationId: { in: ids } } }] };
}

export async function listPayments(ctx: AuthContext | null) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  return db.payment.findMany({
    where: await operatorPaymentScope(ctx.organizationId),
    include: { driver: { select: { name: true, email: true } }, session: { select: { id: true, transactionId: true, amount: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getPayment(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  const p = await db.payment.findFirst({
    where: { id, ...(await operatorPaymentScope(ctx.organizationId)) },
    include: { driver: { select: { name: true, email: true } }, session: true, events: { orderBy: { receivedAt: "desc" } }, refunds: { orderBy: { createdAt: "desc" } } },
  });
  if (!p) throw notFound("Pagamento não encontrado.");
  return p;
}

export type Divergence = { kind: "PAYMENT_WITHOUT_SESSION" | "SESSION_WITHOUT_PAYMENT" | "AMOUNT_MISMATCH" | "STALE_AUTHORIZATION" | "PROVIDER_MISMATCH" | "PROVIDER_UNREACHABLE" | "UNKNOWN_PAYMENT_EVENT"; text: string; paymentId?: string; sessionId?: string };

/**
 * Conciliação do período. Confere sessões encerradas (não demonstrativas) × pagamentos × estado no
 * provedor. Pagamentos que conferem recebem reconciledAt; divergências são listadas.
 */
export async function reconcile(ctx: AuthContext | null, raw: { from: Date; to: Date }) {
  requirePermission(ctx, "payment:reconcile");
  requireOperator(ctx);
  const { from, to } = raw;
  const now = new Date();
  const divergences: Divergence[] = [];
  const payments = await db.payment.findMany({ where: { createdAt: { gte: from, lte: to }, ...(await operatorPaymentScope(ctx.organizationId)) }, include: { session: true, chargeRequest: true } });
  const matched: string[] = [];
  for (const p of payments) {
    const age = now.getTime() - p.createdAt.getTime();
    if (["AUTHORIZED", "CAPTURED"].includes(p.status) && !p.sessionId && age > 10 * 60_000) {
      divergences.push({ kind: "PAYMENT_WITHOUT_SESSION", text: `Pagamento ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()} sem sessão de recarga vinculada.`, paymentId: p.id });
    }
    if (p.status === "AUTHORIZED" && age > 24 * 3600_000) divergences.push({ kind: "STALE_AUTHORIZATION", text: "Autorização há mais de 24 h sem captura nem cancelamento.", paymentId: p.id });
    if (p.session?.amount && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) && !new Decimal(p.amountCaptured.toString()).eq(p.session.amount.toString())) {
      divergences.push({ kind: "AMOUNT_MISMATCH", text: `Capturado ${p.amountCaptured} × apurado na sessão ${p.session.amount}.`, paymentId: p.id, sessionId: p.sessionId! });
    }
    let truth: ProviderPayment | null = null;
    try {
      truth = await getProvider(p.provider).fetch(p.providerRef);
    } catch {
      divergences.push({ kind: "PROVIDER_UNREACHABLE", text: "Não foi possível consultar o provedor; pagamento não verificado.", paymentId: p.id });
    }
    if (truth && (truth.status !== p.status || !new Decimal(truth.amountCaptured).eq(p.amountCaptured.toString()) || !new Decimal(truth.amountRefunded).eq(p.amountRefunded.toString()))) {
      divergences.push({ kind: "PROVIDER_MISMATCH", text: `Local ${p.status}/${p.amountCaptured} × provedor ${truth.status}/${truth.amountCaptured}.`, paymentId: p.id });
    }
    const ok = !divergences.some((d) => d.paymentId === p.id);
    if (ok && truth && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"].includes(p.status)) matched.push(p.id);
  }
  const sessions = await db.chargingSession.findMany({
    where: { status: "COMPLETED", stoppedAt: { gte: from, lte: to }, environment: { not: "SIMULATED" }, driverId: { not: null }, amount: { gt: 0 }, station: { operatorId: ctx.organizationId } },
    include: { payments: true },
  });
  for (const s of sessions) {
    if (!s.payments.some((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"].includes(p.status))) {
      divergences.push({ kind: "SESSION_WITHOUT_PAYMENT", text: `Sessão ${s.transactionId} encerrada (R$ ${s.amount}) sem pagamento capturado.`, sessionId: s.id });
    }
  }
  const orphanEvents = await db.paymentEvent.count({ where: { receivedAt: { gte: from, lte: to }, paymentId: null } });
  if (orphanEvents > 0) divergences.push({ kind: "UNKNOWN_PAYMENT_EVENT", text: `${orphanEvents} evento(s) de webhook sem pagamento correspondente.` });
  if (matched.length) await db.payment.updateMany({ where: { id: { in: matched } }, data: { reconciledAt: now } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.reconciled", entityType: "Payment", data: { from: from.toISOString(), to: to.toISOString(), matched: matched.length, divergences: divergences.length } });
  return { computedAt: now, checked: payments.length, sessionsChecked: sessions.length, matched: matched.length, divergences };
}
