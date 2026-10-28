/**
 * Fluxo de recarga do motorista:
 *   pedido → (pré-autorização de pagamento) → RemoteStart → StartTransaction → sessão → StopTransaction
 *   → valor apurado (tarifa congelada no início) → captura.
 *
 * Regras de ambiente:
 * - SIMULATED: demonstração, sem cobrança (nenhum pagamento é criado).
 * - TEST: exige provedor em ambiente de testes (sandbox local ou sandbox oficial do Asaas).
 * - PRODUCTION: exige Asaas em produção + habilitação aprovada na plataforma (productionReadiness).
 *
 * Fluxos de pagamento:
 * - PREAUTH (sandbox local): reserva → recarga → captura do apurado.
 * - PREPAID (Asaas Pix): Pix pago e CONFIRMADO pelo gateway → recarga → estorno da diferença não consumida.
 * Comando enviado ≠ recarga iniciada: só a StartTransaction do carregador vincula a sessão.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import type { ChargingStation } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { log } from "@/server/log";
import { AppError, notFound } from "@/server/errors";
import { effectiveStatus, type ConnectorStatus } from "@/domain/stations/status";
import { currentTariff } from "@/server/modules/stations/service";
import { activeProvider } from "@/server/payments/registry";
import { cancelPayment, onPaymentStateChange, openReview, settleSessionPayment } from "@/server/payments/service";
import { createChargePayment } from "@/server/payments/charges";
import { productionReadiness } from "@/server/payments/activation";
import { PAYMENT_METHOD_LABEL, PREPAID_METHODS, isPrepaidMethod } from "@/server/payments/provider";
import type { IdTagAuthorizer } from "@/server/ocpp/handler";
import { requireDriver, type DriverContext } from "./auth";

export const START_TIMEOUT_MS = 3 * 60_000;
/** Janela para pagar (Pix ou cartão) antes de a cobrança ser removida no gateway. */
export const pixPaymentWindowMs = () => Math.min(60, Math.max(3, Number(process.env.PIX_PAYMENT_WINDOW_MINUTES ?? 15) || 15)) * 60_000;

export function preauthAmount() {
  const v = Number(process.env.PAYMENT_PREAUTH_AMOUNT ?? 100);
  return new Decimal(Number.isFinite(v) && v > 0 ? v : 100).toFixed(2);
}

/** Valor apurado: energia (kWh) × R$/kWh + duração (min) × R$/min, arredondado a centavos (HALF_UP). */
export function sessionAmount(s: { meterStartWh: number; meterStopWh: number | null; startedAt: Date; stoppedAt: Date | null; tariffPricePerKwh: Decimal.Value | null; tariffPricePerMin: Decimal.Value | null }, now = new Date(), useLastMeter?: number | null) {
  const stopWh = s.meterStopWh ?? useLastMeter ?? s.meterStartWh;
  const kwh = new Decimal(Math.max(0, stopWh - s.meterStartWh)).div(1000);
  const minutes = new Decimal(Math.max(0, (s.stoppedAt ?? now).getTime() - s.startedAt.getTime())).div(60_000);
  const v = kwh.mul(s.tariffPricePerKwh?.toString() ?? 0).plus(minutes.mul(s.tariffPricePerMin?.toString() ?? 0));
  return { kwh, minutes, amount: v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
}

export const startSchema = z.object({ identity: z.string().min(1).max(48), connectorId: z.coerce.number().int().min(1).max(99), method: z.enum(PREPAID_METHODS).default("PIX") });

export async function startCharge(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const { identity, connectorId, method } = startSchema.parse(raw);
  const station = await db.chargingStation.findUnique({ where: { ocppIdentity: identity }, include: { connectors: true, site: { include: { tariffs: true } } } });
  if (!station || station.deletedAt || (!station.site.isPublic && station.environment !== "SIMULATED")) throw notFound("Estação não encontrada.");
  const connector = station.connectors.find((c) => c.connectorId === connectorId);
  if (!connector) throw new AppError("VALIDATION", "Conector inexistente nesta estação.");
  if (station.protocol !== "OCPP16J") throw new AppError("VALIDATION", "Esta estação não está integrada para início pelo aplicativo.");
  const eff = effectiveStatus(connector as { status: ConnectorStatus }, station);
  if (eff.stale) throw new AppError("VALIDATION", "Estação sem comunicação no momento. Não é possível iniciar.");
  if (!["AVAILABLE", "PREPARING"].includes(eff.status)) throw new AppError("VALIDATION", "Conector indisponível no momento.");
  const tariff = currentTariff(station.site.tariffs);
  if (!tariff) throw new AppError("VALIDATION", "Estação sem tarifa vigente: início bloqueado.");
  const demo = station.environment === "SIMULATED";
  const provider = activeProvider();
  if (station.environment === "PRODUCTION") {
    const ready = await productionReadiness(station.operatorId);
    if (!ready.allowed) throw new AppError("VALIDATION", "Pagamentos ainda não estão disponíveis para estações reais. Recarga pelo aplicativo indisponível.");
  }
  if (station.environment === "TEST" && !(provider.status === "configured" && provider.environment === "SANDBOX")) throw new AppError("VALIDATION", "Provedor de pagamento em ambiente de testes não configurado para a estação de teste.");
  if (!demo && provider.flow === "PREPAID" && !(await db.driver.findUnique({ where: { id: driver.driverId } }))?.documentEnc) throw new AppError("VALIDATION", "Informe seu CPF em Minha conta para pagar a recarga.");

  const open = await db.chargeRequest.findFirst({ where: { driverId: driver.driverId, status: { in: ["AWAITING_PAYMENT", "START_REQUESTED", "STARTED"] }, session: { is: null } } });
  if (open) throw new AppError("CONFLICT", "Você já tem um pedido de recarga em andamento.");
  const busy = await db.chargingSession.findFirst({ where: { stationId: station.id, connectorId, status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } } });
  if (busy) throw new AppError("CONFLICT", "Já existe recarga neste conector.");

  const tag = await db.driverIdTag.findFirst({ where: { driverId: driver.driverId, revokedAt: null }, orderBy: { createdAt: "asc" } });
  if (!tag) throw new AppError("VALIDATION", "Conta sem identificador de recarga ativo.");

  let request = await db.chargeRequest.create({
    data: { driverId: driver.driverId, stationId: station.id, connectorId, idTag: tag.idTag, demo, status: demo ? "START_REQUESTED" : "AWAITING_PAYMENT" },
  });
  await audit({ action: "charge.requested", entityType: "ChargeRequest", entityId: request.id, data: { station: identity, connectorId, demo, method } });

  if (demo) return issueStart(request.id);

  // PREAUTH: valor reservado, NÃO cobrado. PREPAID: Pix ou cartão a pagar (valor máximo da recarga; a sobra é devolvida).
  // O pagamento é vinculado ao pedido ANTES de aplicar o estado, para o ouvinte encontrar o pedido.
  try {
    const payment = await createChargePayment({
      provider, operatorId: station.operatorId, siteId: station.siteId, stationEnvironment: station.environment, driverId: driver.driverId, chargeRequestId: request.id,
      amount: preauthAmount(), description: `Recarga ${identity} conector ${connectorId}`, method,
    });
    request = await db.chargeRequest.update({ where: { id: request.id }, data: { paymentId: payment.id } });
    await continueAfterPayment(payment.id); // reservado/pago → inicia; recusado → pedido falha (sem exceção)
  } catch (e) {
    await db.chargeRequest.update({ where: { id: request.id }, data: { status: "FAILED", failure: `Pagamento: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) } });
    if (e instanceof AppError) throw e;
    throw new AppError("VALIDATION", "Não foi possível autorizar o pagamento. Nenhum valor foi cobrado.");
  }
  return db.chargeRequest.findUniqueOrThrow({ where: { id: request.id } });
}

/** Emite o RemoteStart uma única vez: a transição AWAITING_PAYMENT→START_REQUESTED é condicional (eventos concorrentes). */
async function issueStart(requestId: string, from: "AWAITING_PAYMENT" | "START_REQUESTED" = "AWAITING_PAYMENT") {
  return db.$transaction(async (tx) => {
    const claimed = from === "START_REQUESTED" ? 1 : (await tx.chargeRequest.updateMany({ where: { id: requestId, status: "AWAITING_PAYMENT" }, data: { status: "START_REQUESTED" } })).count;
    const req = await tx.chargeRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (claimed !== 1) return req;
    const cmd = await tx.remoteCommand.create({
      data: { stationId: req.stationId, type: "REMOTE_START", payload: { connectorId: req.connectorId, idTag: req.idTag }, requestedById: `driver:${req.driverId}` },
    });
    await audit({ action: "charge.start_authorized", entityType: "ChargeRequest", entityId: req.id, data: { paymentId: req.paymentId, commandId: cmd.id } }, tx);
    return tx.chargeRequest.update({ where: { id: req.id }, data: { status: "START_REQUESTED", commandId: cmd.id } });
  });
}

async function continueAfterPayment(paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const req = await db.chargeRequest.findUnique({ where: { paymentId: payment.id } });
  if (!req) return;
  const funded = (payment.method === "PREAUTH" && payment.status === "AUTHORIZED") || (isPrepaidMethod(payment.method) && payment.status === "CAPTURED");
  if (funded && req.status === "AWAITING_PAYMENT") await issueStart(req.id);
  else if (funded && isPrepaidMethod(payment.method) && ["CANCELLED", "EXPIRED", "FAILED"].includes(req.status) && !req.sessionId)
    await openReview(payment.id, `${PAYMENT_METHOD_LABEL[payment.method]} pago com o pedido ${req.status === "EXPIRED" ? "expirado" : req.status === "CANCELLED" ? "cancelado" : "falho"}: recarga não iniciada; avaliar estorno.`);
  if (["FAILED", "CANCELLED"].includes(payment.status) && ["AWAITING_PAYMENT", "START_REQUESTED"].includes(req.status) && !req.sessionId) {
    await db.chargeRequest.update({ where: { id: req.id }, data: { status: isPrepaidMethod(payment.method) && payment.status === "CANCELLED" ? "EXPIRED" : "FAILED", failure: `Pagamento ${payment.status === "FAILED" ? "recusado" : isPrepaidMethod(payment.method) ? "não realizado no prazo" : "cancelado"}.` } });
  }
}

/** Reação a mudanças de pagamento (síncronas ou por webhook). */
onPaymentStateChange("charge-flow", async (payment) => continueAfterPayment(payment.id));

/** Autorização de idTag no carregador, usada pelo servidor OCPP. */
export const driverAwareAuthorizer: IdTagAuthorizer = {
  async authorize(idTag, station) {
    if (station.environment === "PRODUCTION" && !(await productionReadiness(station.operatorId)).allowed) return "Invalid"; // produção não habilitada
    if (/^(SIM|TEST)-/.test(idTag)) return "Accepted"; // tags de bancada (equipe), nunca cobradas
    const tag = await db.driverIdTag.findUnique({ where: { idTag }, include: { driver: true } });
    if (!tag || tag.revokedAt || tag.driver.disabledAt) return "Invalid";
    if (station.environment === "SIMULATED") return "Accepted";
    // TEST/PRODUÇÃO: exige pedido com pagamento garantido (reservado ou Pix confirmado) — evita sessão sem pagamento.
    const req = await db.chargeRequest.findFirst({ where: { idTag, stationId: station.id, status: "START_REQUESTED", payment: { OR: [{ method: "PREAUTH", status: "AUTHORIZED" }, { method: { in: [...PREPAID_METHODS] }, status: "CAPTURED" }] } } });
    return req ? "Accepted" : "Invalid";
  },
};

/** Chamado pelo handler OCPP após criar a sessão: vincula motorista, pedido, pagamento e congela a tarifa. */
export async function onSessionStarted(station: ChargingStation, sessionId: string) {
  const session = await db.chargingSession.findUniqueOrThrow({ where: { id: sessionId } });
  const tag = await db.driverIdTag.findUnique({ where: { idTag: session.idTag } });
  const tariffs = await db.tariff.findMany({ where: { siteId: station.siteId } });
  const tariff = currentTariff(tariffs, session.startedAt);
  await db.chargingSession.update({
    where: { id: session.id },
    data: { driverId: tag?.driverId ?? null, tariffPricePerKwh: tariff?.pricePerKwh ?? null, tariffPricePerMin: tariff?.pricePerMin ?? null },
  });
  if (!tag || session.status === "COMPLETED") return;
  const req = await db.chargeRequest.findFirst({
    where: { driverId: tag.driverId, stationId: station.id, connectorId: session.connectorId, status: "START_REQUESTED", sessionId: null, createdAt: { gte: new Date(Date.now() - START_TIMEOUT_MS * 2) } },
    orderBy: { createdAt: "desc" },
  });
  if (!req) return;
  await db.chargeRequest.update({ where: { id: req.id }, data: { status: "STARTED", sessionId: session.id } });
  if (req.paymentId) await db.payment.update({ where: { id: req.paymentId }, data: { sessionId: session.id } });
}

/** Chamado após StopTransaction: apura o valor e captura (até o valor reservado). Falhas ficam para a conciliação. */
export async function onSessionStopped(sessionId: string) {
  const s = await db.chargingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { payments: true } });
  if (s.status !== "COMPLETED" || s.stopReason?.startsWith("AUTH_")) return;
  const { amount } = sessionAmount(s);
  await db.chargingSession.update({ where: { id: s.id }, data: { amount: amount.toFixed(2) } });
  const payment = s.payments.find((p) => (p.method === "PREAUTH" && p.status === "AUTHORIZED") || (isPrepaidMethod(p.method) && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status)));
  if (!payment) return;
  try {
    await settleSessionPayment(payment.id, s.id, amount);
  } catch (e) {
    log.error("payment_settlement_failed", { sessionId: s.id, paymentId: payment.id, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Pedidos parados:
 * - aguardando Pix além da janela → cobrança removida no gateway (se o gateway mostrar pago, a recarga segue);
 * - aguardando o carregador além do prazo → pedido falha; reserva (PREAUTH) cancelada; Pix já pago vai para
 *   ANÁLISE (sem estorno automático: verificar se houve consumo antes de devolver).
 */
export async function expireStaleChargeRequests(now = new Date()) {
  const stale = await db.chargeRequest.findMany({
    where: { status: { in: ["START_REQUESTED", "AWAITING_PAYMENT"] }, sessionId: null, createdAt: { lt: new Date(now.getTime() - START_TIMEOUT_MS) } },
    include: { payment: true },
  });
  let n = 0;
  for (const r of stale) {
    const pix = !!r.payment && isPrepaidMethod(r.payment.method); // pré-pago (Pix ou cartão)
    if (r.status === "AWAITING_PAYMENT" && pix && now.getTime() - r.createdAt.getTime() < pixPaymentWindowMs()) continue;
    n++;
    if (r.status === "AWAITING_PAYMENT" && pix && r.paymentId) {
      const after = await cancelPayment(r.paymentId).catch((e) => {
        log.error("payment_cancel_failed", { paymentId: r.paymentId, error: String(e) });
        return null;
      });
      if (after?.status === "CANCELLED") await db.chargeRequest.updateMany({ where: { id: r.id, status: "AWAITING_PAYMENT" }, data: { status: "EXPIRED", failure: `${PAYMENT_METHOD_LABEL[r.payment!.method]}: pagamento não realizado dentro do prazo; cobrança removida.` } });
      continue;
    }
    const upd = await db.chargeRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: "FAILED", failure: "Carregador não iniciou a recarga dentro do prazo." } });
    if (upd.count !== 1 || !r.paymentId) continue;
    if (pix) {
      if (r.payment && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(r.payment.status)) await openReview(r.paymentId, `${PAYMENT_METHOD_LABEL[r.payment.method]} pago e carregador não iniciou a recarga no prazo: avaliar estorno.`);
      else await cancelPayment(r.paymentId).catch((e) => log.error("payment_cancel_failed", { paymentId: r.paymentId, error: String(e) }));
    } else await cancelPayment(r.paymentId).catch((e) => log.error("payment_cancel_failed", { paymentId: r.paymentId, error: String(e) }));
  }
  return n;
}

export async function cancelChargeRequest(driver: DriverContext | null, requestId: string) {
  requireDriver(driver);
  const r = await db.chargeRequest.findFirst({ where: { id: requestId, driverId: driver.driverId } });
  if (!r) throw notFound("Pedido não encontrado.");
  if (r.sessionId || !["AWAITING_PAYMENT", "START_REQUESTED"].includes(r.status)) throw new AppError("CONFLICT", "A recarga já começou; use “Encerrar recarga”.");
  const upd = await db.chargeRequest.updateMany({ where: { id: r.id, status: r.status, sessionId: null }, data: { status: "CANCELLED" } });
  if (upd.count !== 1) throw new AppError("CONFLICT", "O pedido mudou de situação; atualize a página.");
  if (!r.paymentId) return;
  const after = await cancelPayment(r.paymentId);
  // Cobrança pré-paga já paga não é removível: o caso vai para análise (o estorno é decidido pela equipe).
  if (isPrepaidMethod(after.method) && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(after.status)) await openReview(after.id, `${PAYMENT_METHOD_LABEL[after.method]} pago e pedido cancelado pelo motorista antes do início: avaliar estorno.`);
}

/** Encerramento pelo motorista: somente a própria sessão ativa. */
export async function stopCharge(driver: DriverContext | null, sessionId: string) {
  requireDriver(driver);
  const s = await db.chargingSession.findFirst({ where: { id: sessionId, driverId: driver.driverId } });
  if (!s) throw notFound("Sessão não encontrada.");
  if (s.status !== "ACTIVE") throw new AppError("CONFLICT", s.status === "COMMUNICATION_LOST" ? "Carregador sem comunicação: o encerramento será registrado quando ele reconectar." : "Sessão já encerrada.");
  const pending = await db.remoteCommand.findFirst({ where: { stationId: s.stationId, type: "REMOTE_STOP", status: { in: ["PENDING", "SENT"] } } });
  if (pending) return pending;
  const cmd = await db.remoteCommand.create({ data: { stationId: s.stationId, type: "REMOTE_STOP", payload: { transactionId: s.transactionId }, requestedById: `driver:${driver.driverId}` } });
  await audit({ action: "charge.stop_requested", entityType: "ChargingSession", entityId: s.id });
  return cmd;
}

/** O que a tela de início mostra sobre pagamento (sem segredos): fluxo, formas oferecidas e valor cobrado antes. */
export function paymentOptions() {
  const provider = activeProvider();
  const prepaid = provider.flow === "PREPAID";
  return { prepaid, methods: prepaid ? [...PREPAID_METHODS] : [], amount: preauthAmount().toString(), windowMinutes: pixPaymentWindowMs() / 60_000 };
}
