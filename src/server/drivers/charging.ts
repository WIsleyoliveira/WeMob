/**
 * Fluxo de recarga do motorista:
 *   pedido → (pré-autorização de pagamento) → RemoteStart → StartTransaction → sessão → StopTransaction
 *   → valor apurado (tarifa congelada no início) → captura.
 *
 * Regras de ambiente:
 * - SIMULATED: demonstração, sem cobrança (nenhum pagamento é criado).
 * - TEST: exige provedor configurado (sandbox aceito) e pré-autorização antes do início.
 * - PRODUCTION: exige provedor REAL de produção — nenhum está implementado, então é bloqueado.
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
import { capturePayment, cancelPayment, onPaymentStateChange, applyProviderState } from "@/server/payments/service";
import type { IdTagAuthorizer } from "@/server/ocpp/handler";
import { requireDriver, type DriverContext } from "./auth";

export const START_TIMEOUT_MS = 3 * 60_000;

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

export const startSchema = z.object({ identity: z.string().min(1).max(48), connectorId: z.coerce.number().int().min(1).max(99) });

export async function startCharge(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const { identity, connectorId } = startSchema.parse(raw);
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
  if (station.environment === "PRODUCTION" && !(provider.status === "configured" && provider.environment === "PRODUCTION")) {
    throw new AppError("VALIDATION", "Pagamentos ainda não estão disponíveis para estações reais. Recarga pelo aplicativo indisponível.");
  }
  if (station.environment === "TEST" && provider.status !== "configured") throw new AppError("VALIDATION", "Provedor de pagamento (sandbox) não configurado para a estação de teste.");

  const open = await db.chargeRequest.findFirst({ where: { driverId: driver.driverId, status: { in: ["AWAITING_PAYMENT", "START_REQUESTED", "STARTED"] }, session: { is: null } } });
  if (open) throw new AppError("CONFLICT", "Você já tem um pedido de recarga em andamento.");
  const busy = await db.chargingSession.findFirst({ where: { stationId: station.id, connectorId, status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } } });
  if (busy) throw new AppError("CONFLICT", "Já existe recarga neste conector.");

  const tag = await db.driverIdTag.findFirst({ where: { driverId: driver.driverId, revokedAt: null }, orderBy: { createdAt: "asc" } });
  if (!tag) throw new AppError("VALIDATION", "Conta sem identificador de recarga ativo.");

  let request = await db.chargeRequest.create({
    data: { driverId: driver.driverId, stationId: station.id, connectorId, idTag: tag.idTag, demo, status: demo ? "START_REQUESTED" : "AWAITING_PAYMENT" },
  });
  await audit({ action: "charge.requested", entityType: "ChargeRequest", entityId: request.id, data: { station: identity, connectorId, demo } });

  if (demo) return issueStart(request.id);

  // Pré-autorização: valor reservado, NÃO cobrado. Status decidido pelo provedor.
  try {
    const p = await provider.authorize(preauthAmount(), { chargeRequestId: request.id, driverId: driver.driverId });
    const payment = await db.payment.create({
      data: {
        driverId: driver.driverId, provider: provider.name, environment: provider.environment, providerRef: p.providerRef,
        status: "PENDING", amountAuthorized: p.amountAuthorized,
      },
    });
    request = await db.chargeRequest.update({ where: { id: request.id }, data: { paymentId: payment.id } });
    await applyProviderState(payment, p, "authorize"); // dispara continueAfterPayment pelo listener
  } catch (e) {
    await db.chargeRequest.update({ where: { id: request.id }, data: { status: "FAILED", failure: `Pagamento: ${e instanceof Error ? e.message : String(e)}` } });
    throw new AppError("VALIDATION", "Não foi possível autorizar o pagamento. Nenhum valor foi cobrado.");
  }
  return db.chargeRequest.findUniqueOrThrow({ where: { id: request.id } });
}

async function issueStart(requestId: string) {
  const req = await db.chargeRequest.findUniqueOrThrow({ where: { id: requestId } });
  const cmd = await db.remoteCommand.create({
    data: { stationId: req.stationId, type: "REMOTE_START", payload: { connectorId: req.connectorId, idTag: req.idTag }, requestedById: `driver:${req.driverId}` },
  });
  return db.chargeRequest.update({ where: { id: req.id }, data: { status: "START_REQUESTED", commandId: cmd.id } });
}

/** Reação a mudanças de pagamento (síncronas ou por webhook). */
onPaymentStateChange("charge-flow", async (payment) => {
  const req = await db.chargeRequest.findUnique({ where: { paymentId: payment.id } });
  if (!req) return;
  if (payment.status === "AUTHORIZED" && req.status === "AWAITING_PAYMENT") await issueStart(req.id);
  if (["FAILED", "CANCELLED"].includes(payment.status) && ["AWAITING_PAYMENT", "START_REQUESTED"].includes(req.status) && !req.sessionId) {
    await db.chargeRequest.update({ where: { id: req.id }, data: { status: "FAILED", failure: `Pagamento ${payment.status === "FAILED" ? "recusado" : "cancelado"}.` } });
  }
});

/** Autorização de idTag no carregador, usada pelo servidor OCPP. */
export const driverAwareAuthorizer: IdTagAuthorizer = {
  async authorize(idTag, station) {
    if (station.environment === "PRODUCTION") return "Invalid"; // sem gateway de produção configurado
    if (/^(SIM|TEST)-/.test(idTag)) return "Accepted"; // tags de bancada (equipe), nunca cobradas
    const tag = await db.driverIdTag.findUnique({ where: { idTag }, include: { driver: true } });
    if (!tag || tag.revokedAt || tag.driver.disabledAt) return "Invalid";
    if (station.environment === "SIMULATED") return "Accepted";
    // TEST: exige pedido com pagamento autorizado (evita sessão sem pagamento iniciada no local)
    const req = await db.chargeRequest.findFirst({ where: { idTag, status: "START_REQUESTED", payment: { status: "AUTHORIZED" } } });
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
  const payment = s.payments.find((p) => p.status === "AUTHORIZED");
  if (!payment) return;
  try {
    if (amount.isZero()) await cancelPayment(payment.id);
    else await capturePayment(payment.id, amount);
  } catch (e) {
    log.error("payment_capture_failed", { sessionId: s.id, paymentId: payment.id, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Pedidos sem sessão após o prazo: falham e a pré-autorização é cancelada. */
export async function expireStaleChargeRequests(now = new Date()) {
  const stale = await db.chargeRequest.findMany({
    where: { status: { in: ["START_REQUESTED", "AWAITING_PAYMENT"] }, sessionId: null, createdAt: { lt: new Date(now.getTime() - START_TIMEOUT_MS) } },
  });
  for (const r of stale) {
    await db.chargeRequest.update({ where: { id: r.id }, data: { status: "FAILED", failure: "Carregador não iniciou a recarga dentro do prazo." } });
    if (r.paymentId) await cancelPayment(r.paymentId).catch((e) => log.error("payment_cancel_failed", { paymentId: r.paymentId, error: String(e) }));
  }
  return stale.length;
}

export async function cancelChargeRequest(driver: DriverContext | null, requestId: string) {
  requireDriver(driver);
  const r = await db.chargeRequest.findFirst({ where: { id: requestId, driverId: driver.driverId } });
  if (!r) throw notFound("Pedido não encontrado.");
  if (r.sessionId || !["AWAITING_PAYMENT", "START_REQUESTED"].includes(r.status)) throw new AppError("CONFLICT", "A recarga já começou; use “Encerrar recarga”.");
  await db.chargeRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
  if (r.paymentId) await cancelPayment(r.paymentId);
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
