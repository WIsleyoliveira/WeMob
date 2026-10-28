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
import { isPrepaidMethod, type ProviderPayment } from "./provider";
import { ASAAS_EVENT_EXPECTATION, refundMarker } from "@/domain/payments/asaas";
import { syncSplitsFromProvider } from "./split";
import { AsaasError } from "./asaas/client";

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
  // PENDING → CAPTURED: Pix pré-pago (pago = capturado, sem reserva).
  PENDING: ["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
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

/**
 * Aplica o estado informado pelo provedor, respeitando a máquina de estados. Atualização condicional ao
 * status lido (otimista): com eventos concorrentes, só um aplica a mudança e dispara os ouvintes.
 * Também sincroniza tarifa/valor líquido, estornos (pelo marcador) e splits.
 */
export async function applyProviderState(payment: Payment, p: ProviderPayment, source: string, attempt = 0): Promise<{ applied: boolean; payment: Payment }> {
  const to = p.status as PaymentStatus;
  if (!canTransition(payment.status, to)) {
    log.warn("payment_transition_ignored", { paymentId: payment.id, from: payment.status, to, source });
    return { applied: false, payment };
  }
  const net = p.netValue ?? null;
  const fee = net !== null ? new Decimal(p.amountAuthorized).minus(net).toFixed(2) : undefined;
  const r = await db.payment.updateMany({
    where: { id: payment.id, status: payment.status },
    data: {
      status: to,
      amountAuthorized: p.amountAuthorized,
      amountCaptured: p.amountCaptured,
      amountRefunded: p.amountRefunded,
      lastSyncedAt: new Date(),
      ...(p.remoteStatus ? { remoteStatus: p.remoteStatus } : {}),
      ...(net !== null ? { netValue: net, feeAmount: fee } : {}),
      ...(p.invoiceUrl ? { invoiceUrl: p.invoiceUrl } : {}),
      ...(to !== payment.status || !new Decimal(payment.amountCaptured.toString()).eq(p.amountCaptured) || !new Decimal(payment.amountRefunded.toString()).eq(p.amountRefunded) ? { reconciledAt: null } : {}),
    },
  });
  if (r.count !== 1) {
    // Outro processo mudou o status entre a leitura e a gravação: reavalia sobre o estado atual (uma vez).
    const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (attempt >= 1) return { applied: false, payment: fresh };
    return applyProviderState(fresh, p, source, attempt + 1);
  }
  const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (p.refunds) await syncRefunds(payment.id, p.refunds);
  if (p.splits?.length) {
    const changes = await syncSplitsFromProvider(payment.id, p.splits);
    if (changes.length) await audit({ action: "payment.split_status_changed", entityType: "Payment", entityId: payment.id, data: { changes, source } });
  }
  if (updated.status !== payment.status) {
    await audit({ action: "payment.status_changed", entityType: "Payment", entityId: payment.id, data: { from: payment.status, to, source, remoteStatus: p.remoteStatus ?? null } });
    for (const l of listeners) await l(updated).catch((e) => log.error("payment_listener_failed", { error: String(e) }));
  }
  return { applied: true, payment: updated };
}

/** Estornos locais em andamento ← estornos do gateway (casados pelo marcador na descrição). Concluído só com DONE. */
async function syncRefunds(paymentId: string, remote: NonNullable<ProviderPayment["refunds"]>) {
  const pending = await db.refund.findMany({ where: { paymentId, status: "REQUESTED" } });
  for (const r of pending) {
    const m = remote.find((x) => x.description?.includes(refundMarker(r.id)));
    if (!m) continue;
    const status = m.status === "DONE" ? "SUCCEEDED" : m.status === "CANCELLED" ? "FAILED" : "REQUESTED";
    await db.refund.updateMany({ where: { id: r.id, status: "REQUESTED" }, data: { remoteStatus: m.status, status, ...(status !== "REQUESTED" ? { completedAt: new Date() } : {}) } });
  }
}

/** Situação financeira em análise (exige pessoa com payment:review para encerrar). Idempotente por motivo. */
export async function openReview(paymentId: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || (p.reviewOpenedAt && !p.reviewResolvedAt && p.reviewReason === reason)) return;
  await db.payment.update({ where: { id: paymentId }, data: { reviewReason: reason.slice(0, 500), reviewOpenedAt: new Date(), reviewResolvedAt: null, reviewResolvedById: null, reviewNote: null } });
  await audit({ action: "payment.review_opened", entityType: "Payment", entityId: paymentId, data: { reason } });
  log.warn("payment_review_opened", { paymentId, reason });
}

export async function resolveReview(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:review");
  requireOperator(ctx);
  const d = z.object({ paymentId: z.string(), note: z.string().trim().min(10, "Descreva a análise e a providência (ex.: estorno solicitado, ajuste lançado).").max(1000) }).parse(raw);
  const r = await db.payment.updateMany({ where: { id: d.paymentId, reviewOpenedAt: { not: null }, reviewResolvedAt: null, ...(await operatorPaymentScope(ctx.organizationId)) }, data: { reviewResolvedAt: new Date(), reviewResolvedById: ctx.userId, reviewNote: d.note } });
  if (r.count !== 1) throw new AppError("CONFLICT", "Pagamento sem análise em aberto.");
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.review_resolved", entityType: "Payment", entityId: d.paymentId, data: { note: d.note } });
}

/** Payload mínimo para auditoria: identificadores e status, sem dados do pagador. */
function minimalPayload(raw: string): Prisma.InputJsonValue {
  const b = JSON.parse(raw) as Record<string, unknown> & { payment?: Record<string, unknown>; data?: Record<string, unknown>; additionalInfo?: Record<string, unknown> };
  const pick = (o: Record<string, unknown> | undefined, keys: string[]) => (o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : undefined);
  return JSON.parse(JSON.stringify({
    id: b.id, event: b.event, type: b.type, dateCreated: b.dateCreated,
    payment: pick(b.payment, ["id", "status", "value", "netValue", "externalReference", "billingType", "deleted"]),
    data: pick(b.data, ["ref"]), additionalInfo: pick(b.additionalInfo, ["splitId"]),
  })) as Prisma.InputJsonValue;
}

const refFromPayload = (payload: unknown) => {
  const p = payload as { payment?: { id?: string }; data?: { ref?: string } } | null;
  return p?.payment?.id ?? p?.data?.ref ?? "";
};

/** Consulta a fonte de verdade e aplica; trata expectativas do evento (ex.: abrir análise). */
async function processEventForPayment(providerName: string, type: string, payment: Payment, source: string) {
  const truth = await getProvider(providerName).fetch(payment.providerRef);
  const r = await applyProviderState(payment, truth, source);
  const exp = providerName === "asaas" ? ASAAS_EVENT_EXPECTATION[type] : undefined;
  if (exp && !exp.expects.includes(truth.status)) log.info("payment_event_state_differs", { paymentId: payment.id, type, truth: truth.status }); // evento antigo/fora de ordem: vale o estado atual
  if (exp?.review) await openReview(payment.id, `${exp.review} (${type})`);
  return { r, truth };
}

/**
 * Webhook: (1) verifica autenticação; (2) registra evento único por (provedor, id) — reentrega não
 * reprocessa; (3) consulta o provedor (fonte de verdade); (4) aplica a transição.
 * Provedores com ackWebhookBeforeProcessing (Asaas) recebem 200 após o registro mesmo se o processamento
 * falhar: o evento fica pendente e é reprocessado pelo ciclo (a fila do Asaas pausa após 15 falhas).
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
      data: { provider: providerName, eventId: event.eventId, type: event.type, signatureValid: true, payload: minimalPayload(rawBody) },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    row = await db.paymentEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: providerName, eventId: event.eventId } } });
    if (row.processedAt) return { http: 200, outcome: "duplicado (já processado)" };
  }
  if (!event.providerRef) {
    await db.paymentEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), outcome: "evento sem cobrança (registrado e ignorado)", attempts: { increment: 1 } } });
    return { http: 200, outcome: "ignorado" };
  }
  const payment = await db.payment.findUnique({ where: { provider_providerRef: { provider: providerName, providerRef: event.providerRef } } });
  if (!payment) {
    // Pode chegar antes de a cobrança local ser gravada: fica pendente; após 24 h vira divergência de conciliação.
    await db.paymentEvent.update({ where: { id: row.id }, data: { outcome: "pagamento ainda desconhecido (pendente; conciliação)", attempts: { increment: 1 } } });
    return { http: 200, outcome: "pagamento desconhecido" };
  }
  try {
    const { r, truth } = await processEventForPayment(providerName, event.type, payment, `webhook:${event.type}`);
    await db.paymentEvent.update({
      where: { id: row.id },
      data: { paymentId: payment.id, processedAt: new Date(), outcome: r.applied ? `aplicado: ${truth.status}` : `ignorado (fora de ordem): ${truth.status}`, attempts: { increment: 1 } },
    });
    return { http: 200, outcome: r.applied ? truth.status : "ignorado" };
  } catch (e) {
    await db.paymentEvent.update({ where: { id: row.id }, data: { paymentId: payment.id, outcome: `falha ao consultar provedor: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), attempts: { increment: 1 } } });
    if (provider.ackWebhookBeforeProcessing) return { http: 200, outcome: "registrado; processamento pendente" };
    return { http: 503, outcome: "falha ao consultar provedor" };
  }
}

/** Reprocessa eventos não concluídos (provedor indisponível ou cobrança local ainda inexistente). */
export async function retryPendingWebhookEvents(now = new Date()) {
  const pending = await db.paymentEvent.findMany({ where: { processedAt: null, signatureValid: true }, orderBy: { receivedAt: "asc" }, take: 100 });
  let done = 0;
  for (const ev of pending) {
    const ref = refFromPayload(ev.payload);
    const payment = ev.paymentId
      ? await db.payment.findUnique({ where: { id: ev.paymentId } })
      : ref ? await db.payment.findUnique({ where: { provider_providerRef: { provider: ev.provider, providerRef: ref } } }) : null;
    if (!payment) {
      if (now.getTime() - ev.receivedAt.getTime() > 24 * 3600_000) {
        await db.paymentEvent.update({ where: { id: ev.id }, data: { processedAt: now, outcome: "pagamento desconhecido (registrado para conciliação)", attempts: { increment: 1 } } });
      }
      continue;
    }
    try {
      const { r, truth } = await processEventForPayment(ev.provider, ev.type, payment, `retry:${ev.type}`);
      await db.paymentEvent.update({ where: { id: ev.id }, data: { paymentId: payment.id, processedAt: now, outcome: r.applied ? `aplicado na retentativa: ${truth.status}` : "ignorado na retentativa", attempts: { increment: 1 } } });
      done++;
    } catch {
      await db.paymentEvent.update({ where: { id: ev.id }, data: { paymentId: payment.id, attempts: { increment: 1 } } });
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

/** Cancela reserva (PREAUTH) ou remove cobrança pré-paga (Pix/cartão) pendente. Se o gateway mostrar que já foi paga, aplica o pago. */
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

/**
 * Estorno com proteção contra duplicidade: trava por pagamento; disponível = capturado − estornado − estornos
 * em andamento. Concluído somente quando o gateway confirmar (Asaas: refunds[].status = DONE). Timeout não
 * vira falha nem nova tentativa: o estado é verificado pelo marcador na descrição e fica pendente se incerto.
 */
async function performRefund(input: { paymentId: string; amount: Decimal; reason: string; requestedById: string; organizationId?: string | null; scope?: Prisma.PaymentWhereInput }) {
  const { refund, payment } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"refund:" + input.paymentId}))`;
    const payment = await tx.payment.findFirst({ where: { id: input.paymentId, ...(input.scope ?? {}) } });
    if (!payment) throw notFound("Pagamento não encontrado.");
    if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) throw new AppError("CONFLICT", "Só é possível reembolsar pagamento capturado.");
    const inFlight = await tx.refund.aggregate({ where: { paymentId: payment.id, status: "REQUESTED" }, _sum: { amount: true } });
    const available = new Decimal(payment.amountCaptured.toString()).minus(payment.amountRefunded.toString()).minus(inFlight._sum.amount?.toString() ?? 0);
    const amount = input.amount.toDecimalPlaces(2);
    if (amount.gt(available)) throw new AppError("VALIDATION", `Valor acima do disponível para reembolso (${available.toFixed(2)}; considera estornos em andamento).`);
    const refund = await tx.refund.create({ data: { paymentId: payment.id, amount: amount.toFixed(2), reason: input.reason, requestedById: input.requestedById } });
    await audit({ organizationId: input.organizationId ?? payment.operatorId, actorUserId: input.requestedById.startsWith("system:") ? null : input.requestedById, action: "payment.refund_requested", entityType: "Payment", entityId: payment.id, data: { refundId: refund.id, amount: amount.toFixed(2), reason: input.reason } }, tx);
    return { refund, payment };
  });
  const provider = getProvider(payment.provider);
  const description = `${input.reason} ${refundMarker(refund.id)}`;
  try {
    const truth = await provider.refund(payment.providerRef, refund.amount.toString(), { description });
    if (!truth.refunds) await db.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", completedAt: new Date(), providerRef: truth.providerRef, remoteStatus: "DONE" } });
    await applyProviderState(payment, truth, "refund");
  } catch (e) {
    if (e instanceof AsaasError && e.kind === "TIMEOUT") {
      // Resultado incerto: verificar antes de qualquer outra tentativa.
      try {
        const truth = await provider.fetch(payment.providerRef);
        await applyProviderState(payment, truth, "refund-timeout-check");
      } catch {
        /* verificação fica para a conciliação */
      }
      const now = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (now.status === "REQUESTED" && !now.remoteStatus) await db.refund.update({ where: { id: refund.id }, data: { remoteStatus: "UNKNOWN" } });
      return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
    }
    await db.refund.update({ where: { id: refund.id }, data: { status: "FAILED", completedAt: new Date(), remoteStatus: "REJECTED" } });
    throw new AppError("VALIDATION", `Reembolso não confirmado pelo provedor: ${e instanceof Error ? e.message : String(e)}`);
  }
  return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
}

/** Reembolso solicitado pela equipe (payment:refund), com motivo, valor e auditoria. */
export async function requestRefund(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "payment:refund");
  requireOperator(ctx);
  const d = refundSchema.parse(raw);
  return performRefund({ paymentId: d.paymentId, amount: new Decimal(d.amount), reason: d.reason, requestedById: ctx.userId, organizationId: ctx.organizationId, scope: await operatorPaymentScope(ctx.organizationId) });
}

/**
 * Acerto ao fim da sessão.
 *  - PREAUTH: captura o apurado (até o reservado) ou cancela se zero.
 *  - PREPAID (Pix ou cartão): estorna a diferença não consumida (uma única vez por sessão, chave idempotente);
 *    consumo acima do pago abre análise (não há cobrança complementar automática).
 */
export async function settleSessionPayment(paymentId: string, sessionId: string, amount: Decimal) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!isPrepaidMethod(payment.method)) {
    if (payment.status !== "AUTHORIZED") return payment;
    return amount.isZero() ? cancelPayment(payment.id) : capturePayment(payment.id, amount);
  }
  if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    await openReview(payment.id, `Sessão encerrada com pagamento ${payment.status}: acerto não executado.`);
    return payment;
  }
  const paid = new Decimal(payment.amountCaptured.toString()).minus(payment.amountRefunded.toString());
  const diff = paid.minus(amount);
  if (diff.lt(0)) {
    await openReview(payment.id, `Consumo acima do valor pré-pago: R$ ${diff.abs().toFixed(2)} não cobrados (sem cobrança complementar automática).`);
    return payment;
  }
  if (diff.isZero()) return payment;
  const key = `settle:${sessionId}`;
  try {
    await db.paymentOperation.create({ data: { key, kind: "SETTLE_REFUND", provider: payment.provider, environment: payment.environment, operatorId: payment.operatorId, paymentId: payment.id, request: { amount: diff.toFixed(2) } } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return payment; // acerto já executado
    throw e;
  }
  try {
    const refund = await performRefund({ paymentId: payment.id, amount: diff, reason: "Devolução do saldo pré-pago não consumido", requestedById: "system:settlement" });
    await db.paymentOperation.update({ where: { key }, data: { status: refund.status === "FAILED" ? "FAILED" : refund.status === "SUCCEEDED" ? "SUCCEEDED" : "UNKNOWN", response: { refundId: refund.id, status: refund.status } } });
  } catch (e) {
    await db.paymentOperation.update({ where: { key }, data: { status: "FAILED", lastError: e instanceof Error ? e.message.slice(0, 300) : String(e) } });
    await openReview(payment.id, `Falha ao devolver o saldo não consumido (R$ ${diff.toFixed(2)}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return db.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

/**
 * Escopo multiempresa: pagamentos da operadora (coluna operatorId, ou — para registros antigos — pela
 * sessão/pedido de recarga em estações da operadora). Sem isso, outra operadora veria a rede inteira.
 */
export async function operatorPaymentScope(operatorId: string): Promise<Prisma.PaymentWhereInput> {
  const ids = (await db.chargingStation.findMany({ where: { operatorId }, select: { id: true } })).map((s) => s.id);
  return { OR: [{ operatorId }, { operatorId: null, session: { stationId: { in: ids } } }, { operatorId: null, chargeRequest: { stationId: { in: ids } } }] };
}

export const paymentFilterSchema = z.object({
  status: z.enum(["PENDING", "AUTHORIZED", "CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED", "CANCELLED", "DISPUTED"]).optional(),
  review: z.coerce.boolean().optional(),
});

export async function listPayments(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  const f = paymentFilterSchema.parse(raw);
  return db.payment.findMany({
    where: { ...(await operatorPaymentScope(ctx.organizationId)), ...(f.status ? { status: f.status } : {}), ...(f.review ? { reviewOpenedAt: { not: null }, reviewResolvedAt: null } : {}) },
    include: { driver: { select: { name: true, email: true } }, session: { select: { id: true, transactionId: true, amount: true, status: true } }, splits: { select: { status: true, totalValue: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/** Resumo para o painel: pendentes, confirmados, estornos, análises e eventos não processados. */
export async function paymentsOverview(ctx: AuthContext | null) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  const scope = await operatorPaymentScope(ctx.organizationId);
  const [byStatus, review, refundsPending, splitsByStatus, eventsPending, unknownOps] = await Promise.all([
    db.payment.groupBy({ by: ["status", "environment"], where: scope, _count: true, _sum: { amountCaptured: true, amountRefunded: true, feeAmount: true } }),
    db.payment.count({ where: { ...scope, reviewOpenedAt: { not: null }, reviewResolvedAt: null } }),
    db.refund.count({ where: { status: "REQUESTED", payment: scope } }),
    db.paymentSplit.groupBy({ by: ["status"], where: { operatorId: ctx.organizationId }, _count: true, _sum: { totalValue: true } }),
    db.paymentEvent.count({ where: { processedAt: null } }),
    db.paymentOperation.count({ where: { operatorId: ctx.organizationId, status: "UNKNOWN" } }),
  ]);
  return { byStatus, review, refundsPending, splitsByStatus, eventsPending, unknownOps };
}

export async function getPayment(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "payment:read");
  requireOperator(ctx);
  const p = await db.payment.findFirst({
    where: { id, ...(await operatorPaymentScope(ctx.organizationId)) },
    include: { driver: { select: { name: true, email: true } }, session: true, events: { orderBy: { receivedAt: "desc" } }, refunds: { orderBy: { createdAt: "desc" } }, splits: { orderBy: { createdAt: "asc" } } },
  });
  if (!p) throw notFound("Pagamento não encontrado.");
  return p;
}

export type DivergenceKind =
  | "PAYMENT_WITHOUT_SESSION" | "SESSION_WITHOUT_PAYMENT" | "AMOUNT_MISMATCH" | "STALE_AUTHORIZATION" | "PROVIDER_MISMATCH" | "PROVIDER_UNREACHABLE" | "UNKNOWN_PAYMENT_EVENT"
  | "LOCAL_WITHOUT_REMOTE" | "REMOTE_WITHOUT_LOCAL" | "DUPLICATE_CHARGE" | "OPERATION_UNKNOWN" | "REFUND_PENDING" | "SPLIT_NOT_SETTLED" | "SPLIT_DIVERGENCE" | "UNPROCESSED_WEBHOOK" | "UNDER_REVIEW";
export type Divergence = { kind: DivergenceKind; text: string; paymentId?: string; sessionId?: string; remoteId?: string; amount?: string };

const MAX_FETCH_PER_RUN = 200;

/**
 * Conciliação do período (local × provedor). Usa a API autenticada com limite de consultas por execução
 * (cota do Asaas: 25.000 requisições/12 h). NUNCA cria cobranças nem estornos para "corrigir": só aponta.
 * Pagamentos que conferem recebem reconciledAt.
 */
export async function reconcile(ctx: AuthContext | null, raw: { from: Date; to: Date }) {
  requirePermission(ctx, "payment:reconcile");
  requireOperator(ctx);
  const { from, to } = raw;
  const now = new Date();
  const divergences: Divergence[] = [];
  const payments = await db.payment.findMany({
    where: { createdAt: { gte: from, lte: to }, ...(await operatorPaymentScope(ctx.organizationId)) },
    include: { session: true, chargeRequest: true, refunds: true, splits: true },
    take: MAX_FETCH_PER_RUN,
    orderBy: { createdAt: "asc" },
  });
  const matched: string[] = [];
  for (const p of payments) {
    const age = now.getTime() - p.createdAt.getTime();
    if (["AUTHORIZED", "CAPTURED"].includes(p.status) && !p.sessionId && age > 10 * 60_000) {
      divergences.push({ kind: "PAYMENT_WITHOUT_SESSION", text: `Pagamento ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()} sem sessão de recarga vinculada.`, paymentId: p.id });
    }
    if (p.status === "AUTHORIZED" && age > 24 * 3600_000) divergences.push({ kind: "STALE_AUTHORIZATION", text: "Autorização há mais de 24 h sem captura nem cancelamento.", paymentId: p.id });
    const pendingRefund = p.refunds.some((r) => r.status === "REQUESTED");
    if (p.session?.amount && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)) {
      // PREAUTH: capturado deve igualar o apurado. Pré-pago (Pix/cartão): pago − estornado deve igualar o apurado (após o acerto).
      const charged = isPrepaidMethod(p.method) ? new Decimal(p.amountCaptured.toString()).minus(p.amountRefunded.toString()) : new Decimal(p.amountCaptured.toString());
      if (!charged.eq(p.session.amount.toString()) && !pendingRefund) {
        divergences.push({ kind: "AMOUNT_MISMATCH", text: `${isPrepaidMethod(p.method) ? "Pago − estornado" : "Capturado"} ${charged.toFixed(2)} × apurado na sessão ${p.session.amount}.`, paymentId: p.id, sessionId: p.sessionId! });
      }
    }
    for (const r of p.refunds.filter((x) => x.status === "REQUESTED" && now.getTime() - x.createdAt.getTime() > 3600_000)) {
      divergences.push({ kind: "REFUND_PENDING", text: `Estorno de R$ ${r.amount} pendente há mais de 1 h (gateway: ${r.remoteStatus ?? "sem resposta"}).`, paymentId: p.id, amount: r.amount.toFixed(2) });
    }
    for (const sp of p.splits) {
      if (sp.status === "BLOCKED_BY_VALUE_DIVERGENCE") divergences.push({ kind: "SPLIT_DIVERGENCE", text: `Split ${sp.externalReference} bloqueado por divergência de valor (prazo de correção: 2 dias úteis).`, paymentId: p.id });
      else if (["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) && !["DONE", "CANCELLED", "REFUNDED"].includes(sp.status) && age > 3 * 86400_000)
        divergences.push({ kind: "SPLIT_NOT_SETTLED", text: `Split ${sp.externalReference} ainda ${sp.status} após 3 dias.`, paymentId: p.id });
    }
    if (p.netValue && p.splits.length) {
      const distributed = p.splits.reduce((a, x) => a.plus(x.totalValue?.toString() ?? 0), new Decimal(0));
      if (distributed.gt(p.netValue.toString())) divergences.push({ kind: "SPLIT_DIVERGENCE", text: `Splits somam ${distributed.toFixed(2)} acima do líquido ${p.netValue}.`, paymentId: p.id });
    }
    if (p.reviewOpenedAt && !p.reviewResolvedAt) divergences.push({ kind: "UNDER_REVIEW", text: `Em análise: ${p.reviewReason}`, paymentId: p.id });
    let truth: ProviderPayment | null = null;
    try {
      truth = await getProvider(p.provider).fetch(p.providerRef);
    } catch (e) {
      if (e instanceof AsaasError && e.kind === "NOT_FOUND") divergences.push({ kind: "LOCAL_WITHOUT_REMOTE", text: "Cobrança local não encontrada no gateway.", paymentId: p.id });
      else divergences.push({ kind: "PROVIDER_UNREACHABLE", text: "Não foi possível consultar o provedor; pagamento não verificado.", paymentId: p.id });
    }
    if (truth && (truth.status !== p.status || !new Decimal(truth.amountCaptured).eq(p.amountCaptured.toString()) || !new Decimal(truth.amountRefunded).eq(p.amountRefunded.toString()))) {
      divergences.push({ kind: "PROVIDER_MISMATCH", text: `Local ${p.status}/${p.amountCaptured} × provedor ${truth.status}/${truth.amountCaptured} (${truth.remoteStatus ?? ""}).`, paymentId: p.id });
    }
    const ok = !divergences.some((d) => d.paymentId === p.id);
    if (ok && truth && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"].includes(p.status)) matched.push(p.id);
  }

  // Remoto × local (somente provedores com listagem: Asaas).
  const provider = getProvider(process.env.PAYMENT_PROVIDER ?? "");
  if (provider.listRemote) {
    try {
      const remote = await provider.listRemote({ from, to });
      const known = new Set((await db.payment.findMany({ where: { provider: provider.name, providerRef: { in: remote.map((r) => r.providerRef) } }, select: { providerRef: true } })).map((x) => x.providerRef));
      const byRef = new Map<string, number>();
      for (const r of remote) {
        if (r.externalReference) byRef.set(r.externalReference, (byRef.get(r.externalReference) ?? 0) + 1);
        if (!known.has(r.providerRef) && r.remoteStatus !== "DELETED")
          divergences.push({ kind: "REMOTE_WITHOUT_LOCAL", text: `Cobrança no gateway sem vínculo local (${r.remoteStatus}, R$ ${r.amountAuthorized}, ref ${r.externalReference ?? "—"}).`, remoteId: r.providerRef, amount: r.amountAuthorized });
      }
      for (const [ref, n] of byRef) if (n > 1) divergences.push({ kind: "DUPLICATE_CHARGE", text: `${n} cobranças no gateway com a mesma chave ${ref}.` });
    } catch {
      divergences.push({ kind: "PROVIDER_UNREACHABLE", text: "Não foi possível listar as cobranças do gateway no período." });
    }
  }
  const unknownOps = await db.paymentOperation.findMany({ where: { operatorId: ctx.organizationId, status: "UNKNOWN" }, take: 50 });
  for (const op of unknownOps) {
    let found: ProviderPayment[] | null = null;
    try {
      found = provider.findByExternalReference ? await provider.findByExternalReference(op.key) : null;
    } catch {
      found = null;
    }
    divergences.push({ kind: "OPERATION_UNKNOWN", text: `Operação ${op.kind} com resultado desconhecido (chave ${op.key}): ${found === null ? "não verificada" : found.length ? `${found.length} cobrança(s) encontradas no gateway — vincular manualmente` : "nada encontrado no gateway"}.` });
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
  const orphanEvents = await db.paymentEvent.count({ where: { receivedAt: { gte: from, lte: to }, paymentId: null, processedAt: { not: null } } });
  if (orphanEvents > 0) divergences.push({ kind: "UNKNOWN_PAYMENT_EVENT", text: `${orphanEvents} evento(s) de webhook sem pagamento correspondente.` });
  const stuck = await db.paymentEvent.count({ where: { processedAt: null, receivedAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
  if (stuck > 0) divergences.push({ kind: "UNPROCESSED_WEBHOOK", text: `${stuck} evento(s) de webhook ainda não processado(s) há mais de 10 min (reprocessamento automático em curso).` });
  if (matched.length) await db.payment.updateMany({ where: { id: { in: matched } }, data: { reconciledAt: now } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "payment.reconciled", entityType: "Payment", data: { from: from.toISOString(), to: to.toISOString(), matched: matched.length, divergences: divergences.length } });
  return { computedAt: now, checked: payments.length, sessionsChecked: sessions.length, matched: matched.length, divergences, truncated: payments.length === MAX_FETCH_PER_RUN };
}
