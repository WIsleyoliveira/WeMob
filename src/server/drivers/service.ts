import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { notFound, AppError } from "@/server/errors";
import { effectiveStatus, isStationFresh, type ConnectorStatus } from "@/domain/stations/status";
import { currentTariff, sessionEnergyWh } from "@/server/modules/stations/service";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { encryptField } from "@/server/crypto";
import { documentHint, isValidDocument, onlyDigits } from "@/domain/br/document";
import { hit } from "@/server/rate-limit";
import { log } from "@/server/log";
import { getProvider } from "@/server/payments/registry";
import { refreshFromProvider } from "@/server/payments/charges";
import { requireDriver, type DriverContext } from "./auth";
import { sessionAmount } from "./charging";
import { HISTORY_STATE_TO_SESSION, periodStart, type HistoryFilters } from "@/domain/charging/history";
import { supportSubject, type HelpTopic } from "@/domain/support/driver-help";
import Decimal from "decimal.js";
import { granularityFor, periodRange, usageSeries, usageTotals, type UsagePeriod, type UsageSession } from "@/domain/usage/series";

export async function getProfile(driver: DriverContext | null) {
  requireDriver(driver);
  return db.driver.findUniqueOrThrow({
    where: { id: driver.driverId },
    select: { id: true, name: true, email: true, phone: true, documentHint: true, createdAt: true, vehicles: { orderBy: { createdAt: "asc" } }, idTags: { where: { revokedAt: null }, select: { idTag: true, kind: true } } },
  });
}

export async function updateProfile(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const d = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(20).optional().transform((v) => (v ? v.replace(/\D/g, "") : null)) }).parse(raw);
  await db.driver.update({ where: { id: driver.driverId }, data: d });
}

export const vehicleSchema = z.object({
  label: z.string().trim().min(2, "Ex.: BYD Dolphin 2024").max(80),
  connectorTypes: z.array(z.enum(["CCS2", "TYPE2", "CHADEMO", "GBT", "OTHER"])).min(1, "Escolha ao menos um conector.").max(5),
  batteryKwh: z.coerce.number().gt(0).max(300).optional(),
});

export async function addVehicle(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const d = vehicleSchema.parse(raw);
  if ((await db.vehicle.count({ where: { driverId: driver.driverId } })) >= 10) throw new AppError("VALIDATION", "Limite de 10 veículos.");
  return db.vehicle.create({ data: { ...d, driverId: driver.driverId } });
}

/** Conectores dos veículos do motorista, para indicar compatibilidade (só pelo tipo de conector). */
export async function listMyVehicles(driver: DriverContext | null) {
  if (!driver) return [];
  return db.vehicle.findMany({ where: { driverId: driver.driverId }, select: { label: true, connectorTypes: true }, orderBy: { createdAt: "asc" } });
}

export async function removeVehicle(driver: DriverContext | null, vehicleId: string) {
  requireDriver(driver);
  const r = await db.vehicle.deleteMany({ where: { id: vehicleId, driverId: driver.driverId } });
  if (r.count === 0) throw notFound("Veículo não encontrado.");
}

const stationInclude = { connectors: { orderBy: { connectorId: "asc" } }, site: { include: { tariffs: true } } } as const;
type StationRow = Prisma.ChargingStationGetPayload<{ include: typeof stationInclude }>;

function toDriverStation(s: StationRow, now: Date) {
  return {
    id: s.id,
    identity: s.ocppIdentity,
    environment: s.environment,
    site: { name: s.site.name, address: s.site.address, city: s.site.city, state: s.site.state, openingHours: s.site.openingHours, latitude: s.site.latitude?.toString() ?? null, longitude: s.site.longitude?.toString() ?? null },
    fresh: isStationFresh(s, now),
    lastSeenAt: s.lastSeenAt,
    tariff: currentTariff(s.site.tariffs, now),
    connectors: s.connectors.map((c) => ({ connectorId: c.connectorId, type: c.type, maxPowerKw: c.maxPowerKw.toString(), status: effectiveStatus(c as { status: ConnectorStatus }, s, now).status, statusReceivedAt: c.statusReceivedAt })),
  };
}

/**
 * Estações listadas ao motorista. "real": unidades públicas com equipamento de produção.
 * "demo": estações SIMULADAS (ambiente de demonstração, sem cobrança).
 */
export async function listDriverStations(mode: "real" | "demo") {
  const now = new Date();
  const stations = await db.chargingStation.findMany({
    where: mode === "demo" ? { environment: "SIMULATED", deletedAt: null } : { environment: "PRODUCTION", deletedAt: null, site: { isPublic: true, deletedAt: null } },
    include: stationInclude,
    orderBy: { ocppIdentity: "asc" },
  });
  return stations.map((s) => toDriverStation(s, now));
}

/**
 * Estação aberta pelo link/QR Code. Além das listadas, aceita estações de TESTE (homologação com o gateway em
 * sandbox): não aparecem na lista, mas são acessíveis pelo endereço direto, como o QR Code impresso.
 */
export async function getDriverStation(identity: string) {
  const s = await db.chargingStation.findFirst({
    where: { ocppIdentity: identity, deletedAt: null, OR: [{ environment: "SIMULATED" }, { environment: { in: ["PRODUCTION", "TEST"] }, site: { isPublic: true, deletedAt: null } }] },
    include: stationInclude,
  });
  if (!s) throw notFound("Estação não encontrada.");
  return toDriverStation(s, new Date());
}

export async function listMySessions(driver: DriverContext | null, filters: HistoryFilters = {}) {
  requireDriver(driver);
  // O escopo é SEMPRE o próprio motorista; os filtros só restringem.
  const since = periodStart(filters.periodo);
  return db.chargingSession.findMany({
    where: {
      driverId: driver.driverId,
      ...(since ? { startedAt: { gte: since } } : {}),
      ...(filters.estacao ? { station: { ocppIdentity: filters.estacao } } : {}),
      ...(filters.estado ? { status: HISTORY_STATE_TO_SESSION[filters.estado] } : {}),
    },
    include: { station: { select: { ocppIdentity: true, site: { select: { name: true } } } }, payments: { select: { status: true, amountCaptured: true, amountRefunded: true, environment: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
}

/**
 * Consumo do próprio motorista no período (recargas CONCLUÍDAS). Por padrão só estações reais (PRODUCTION):
 * teste/demonstração entram apenas com `includeTest`, e a tela identifica. Dinheiro = somente o confirmado pelo
 * gateway (capturado − estornado); sessão sem pagamento confirmado conta como "não confirmado", nunca como zero pago.
 */
export async function myUsage(driver: DriverContext | null, opts: { period: UsagePeriod; includeTest?: boolean }, now = new Date()) {
  requireDriver(driver);
  const { from, to } = periodRange(opts.period, now);
  const envs = opts.includeTest ? (["PRODUCTION", "TEST", "SIMULATED"] as const) : (["PRODUCTION"] as const);
  const rows = await db.chargingSession.findMany({
    where: { driverId: driver.driverId, status: "COMPLETED", startedAt: { gte: from, lte: to }, environment: { in: [...envs] } },
    include: { payments: { select: { status: true, amountCaptured: true, amountRefunded: true } } },
    orderBy: { startedAt: "asc" },
  });
  const sessions: UsageSession[] = rows.map((r) => {
    const confirmed = r.payments.filter((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
    return {
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      energyWh: sessionEnergyWh(r),
      paidConfirmed: confirmed.length ? confirmed.reduce((a, p) => a.plus(p.amountCaptured.toString()).minus(p.amountRefunded.toString()), new Decimal(0)).toFixed(2) : null,
    };
  });
  const otherEnvSessions = opts.includeTest ? 0 : await db.chargingSession.count({ where: { driverId: driver.driverId, status: "COMPLETED", startedAt: { gte: from, lte: to }, environment: { in: ["TEST", "SIMULATED"] } } });
  const granularity = granularityFor(from, to);
  return { from, to, granularity, includeTest: !!opts.includeTest, totals: usageTotals(sessions), series: usageSeries(sessions, from, to, granularity), otherEnvSessions, computedAt: now };
}

/** Estações onde o motorista já carregou (opções do filtro do histórico). */
export async function listMySessionStations(driver: DriverContext | null) {
  requireDriver(driver);
  const rows = await db.chargingStation.findMany({
    where: { sessions: { some: { driverId: driver.driverId } } },
    select: { ocppIdentity: true, site: { select: { name: true } } },
    orderBy: { ocppIdentity: "asc" },
  });
  return rows.map((r) => ({ identity: r.ocppIdentity, name: r.site.name }));
}

export async function getActiveRequest(driver: DriverContext | null) {
  requireDriver(driver);
  return db.chargeRequest.findFirst({
    where: { driverId: driver.driverId, OR: [{ status: { in: ["AWAITING_PAYMENT", "START_REQUESTED"] } }, { status: "STARTED", session: { status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } } }] },
    include: { payment: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Sessão do próprio motorista com valores estimados (em andamento) ou apurados (encerrada). */
export async function getMySession(driver: DriverContext | null, sessionId: string) {
  requireDriver(driver);
  const s = await db.chargingSession.findFirst({
    where: { id: sessionId, driverId: driver.driverId },
    include: { station: { include: { site: true } }, payments: { include: { refunds: true } }, rating: true, chargeRequest: true, measurements: { orderBy: { timestamp: "desc" }, take: 1 } },
  });
  if (!s) throw notFound("Sessão não encontrada.");
  const live = s.status !== "COMPLETED";
  const calc = sessionAmount(s, new Date(), s.lastMeterWh);
  // Último pedido de parada DESTA transação (motorista, limite financeiro ou equipe): o estado sobrevive a recarregar a página.
  const stop = await db.remoteCommand.findFirst({
    where: { stationId: s.stationId, type: "REMOTE_STOP", payload: { equals: { transactionId: s.transactionId } }, createdAt: { gte: s.startedAt } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, requestedById: true, createdAt: true },
  });
  return {
    session: s,
    energyKwh: sessionEnergyWh(s) / 1000,
    minutes: calc.minutes.toNumber(),
    amount: calc.amount.toFixed(2),
    amountKind: live ? ("ESTIMATED" as const) : ("COMPUTED" as const),
    payment: s.payments[0] ?? null,
    demo: s.environment === "SIMULATED",
    lastPowerW: s.measurements[0]?.powerW ?? null,
    /** Horário (relógio do carregador) da última medição recebida. */
    lastMeasurementAt: s.measurements[0]?.timestamp ?? null,
    /** Última comunicação do carregador (relógio do servidor). */
    lastSeenAt: s.station.lastSeenAt,
    stopCommand: stop ? { id: stop.id, status: stop.status, byLimit: stop.requestedById === "system:limit", createdAt: stop.createdAt } : null,
  };
}

export async function rateSession(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const d = z.object({ sessionId: z.string(), stars: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() }).parse(raw);
  const s = await db.chargingSession.findFirst({ where: { id: d.sessionId, driverId: driver.driverId, status: "COMPLETED" } });
  if (!s) throw notFound("Sessão não encontrada ou ainda em andamento.");
  return db.sessionRating.upsert({ where: { sessionId: s.id }, create: { sessionId: s.id, stars: d.stars, comment: d.comment }, update: { stars: d.stars, comment: d.comment } });
}

export async function createSupportRequest(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const d = z
    .object({
      topic: z.enum(["SEM_INICIO", "DUPLICADA", "VALOR_DIVERGENTE", "NAO_ENCERRA", "SEM_RESPOSTA", "ESTORNO", "OUTRO"] satisfies HelpTopic[]).optional(),
      subject: z.string().trim().max(120).default(""),
      message: z.string().trim().min(10, "Descreva o problema.").max(3000),
      sessionId: z.string().optional(),
      requestId: z.string().optional(),
    })
    .transform(({ topic, subject, ...rest }) => ({ ...rest, subject: supportSubject(topic, subject) }))
    .refine((v) => v.subject.length >= 3, { message: "Informe o assunto ou escolha o tipo de problema.", path: ["subject"] })
    .parse(raw);
  // Pedido sem recarga iniciada (ex.: pagou e não começou): a referência vai na mensagem, conferida antes.
  if (d.requestId && !(await db.chargeRequest.findFirst({ where: { id: d.requestId, driverId: driver.driverId } }))) throw notFound("Pedido não encontrado.");
  if (d.sessionId && !(await db.chargingSession.findFirst({ where: { id: d.sessionId, driverId: driver.driverId } }))) throw notFound("Sessão não encontrada.");
  if (!(await hit(`driver-support:${driver.driverId}`, 10, 3600_000))) throw new AppError("RATE_LIMITED", "Muitos chamados em pouco tempo. Aguarde e, se for urgente, responda ao chamado já aberto.");
  const { requestId, ...data } = d;
  return db.supportRequest.create({ data: { ...data, message: requestId ? `[Pedido ${requestId}] ${data.message}`.slice(0, 3000) : data.message, driverId: driver.driverId } });
}

export async function listMySupport(driver: DriverContext | null) {
  requireDriver(driver);
  return db.supportRequest.findMany({ where: { driverId: driver.driverId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getMyChargeRequest(driver: DriverContext | null, id: string) {
  requireDriver(driver);
  const r = await db.chargeRequest.findFirst({ where: { id, driverId: driver.driverId }, include: { payment: true } });
  if (!r) return null;
  // Estado real da ordem de início no carregador: enviada ≠ aceita ≠ recarga iniciada.
  const cmd = r.commandId ? await db.remoteCommand.findUnique({ where: { id: r.commandId }, select: { status: true } }) : null;
  return { ...r, startCommandStatus: cmd?.status ?? null };
}

// ── LGPD: acesso/portabilidade e eliminação a pedido do titular ──

/** Cópia dos dados pessoais do motorista (art. 18, II e V, LGPD). Não há dados de cartão na plataforma. */
export async function exportMyData(driver: DriverContext | null) {
  requireDriver(driver);
  const d = await db.driver.findUniqueOrThrow({
    where: { id: driver.driverId },
    select: {
      id: true, name: true, email: true, phone: true, consentAt: true, consentVer: true, createdAt: true,
      vehicles: { select: { label: true, connectorTypes: true, batteryKwh: true, createdAt: true } },
      idTags: { select: { idTag: true, kind: true, createdAt: true, revokedAt: true } },
      chargingSessions: { select: { id: true, startedAt: true, stoppedAt: true, meterStartWh: true, meterStopWh: true, amount: true, environment: true, rating: { select: { stars: true, comment: true } } } },
      payments: { select: { id: true, provider: true, status: true, amountAuthorized: true, amountCaptured: true, amountRefunded: true, createdAt: true } },
      supportRequests: { select: { subject: true, message: true, status: true, createdAt: true } },
    },
  });
  await db.auditEvent.create({ data: { action: "driver.data_exported", entityType: "Driver", entityId: driver.driverId } });
  return { geradoEm: new Date().toISOString(), observacao: "Dados pessoais mantidos pela Sansol Mob sobre o titular. Pagamentos não incluem dados de cartão (não armazenados).", titular: d };
}

/**
 * Eliminação a pedido do titular: dados identificadores são ANONIMIZADOS e o acesso encerrado.
 * Sessões e pagamentos são mantidos sem identificação direta para cumprimento de obrigação legal
 * (registros fiscais/contábeis, art. 16, I, LGPD) — prazo de retenção a definir com o jurídico/DPO.
 */
export async function deleteMyAccount(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const { password } = z.object({ password: z.string().min(1).max(128), confirm: z.literal(true, { error: "Confirme a exclusão." }) }).parse(raw);
  const d = await db.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
  if (!(await verifyPassword(password, d.passwordHash))) throw new AppError("VALIDATION", "Senha incorreta.");
  const busy = await db.chargeRequest.findFirst({ where: { driverId: d.id, status: { in: ["AWAITING_PAYMENT", "START_REQUESTED"] } } });
  const active = await db.chargingSession.findFirst({ where: { driverId: d.id, status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } } });
  if (busy || active) throw new AppError("CONFLICT", "Há uma recarga em andamento. Encerre-a antes de excluir a conta.");
  const now = new Date();
  await db.$transaction([
    db.driver.update({ where: { id: d.id }, data: { name: "Titular removido", email: `removido-${d.id}@anonimizado.invalid`, phone: null, passwordHash: await hashPassword(randomBytes(32).toString("hex")), disabledAt: now } }),
    db.vehicle.deleteMany({ where: { driverId: d.id } }),
    db.driverIdTag.updateMany({ where: { driverId: d.id, revokedAt: null }, data: { revokedAt: now } }),
    db.driverSession.updateMany({ where: { driverId: d.id, revokedAt: null }, data: { revokedAt: now } }),
    db.sessionRating.updateMany({ where: { session: { driverId: d.id } }, data: { comment: null } }),
    db.supportRequest.updateMany({ where: { driverId: d.id }, data: { message: "[removido a pedido do titular]" } }),
    db.auditEvent.create({ data: { action: "driver.account_deleted", entityType: "Driver", entityId: d.id } }),
  ]);
}

/** CPF/CNPJ do pagador (exigido pelo Asaas): validado, cifrado em repouso e exibido só mascarado. */
export async function setMyDocument(driver: DriverContext | null, raw: unknown) {
  requireDriver(driver);
  const { document } = z.object({ document: z.string().trim().min(11).max(18) }).parse(raw);
  if (!isValidDocument(document)) throw new AppError("VALIDATION", "CPF/CNPJ inválido.");
  const digits = onlyDigits(document);
  await db.driver.update({ where: { id: driver.driverId }, data: { documentEnc: encryptField(digits), documentHint: documentHint(digits) } });
  // Cadastro no gateway com documento antigo deixa de valer: será recriado/reaproveitado pela chave externa.
  await db.gatewayCustomer.deleteMany({ where: { driverId: driver.driverId } });
  await db.auditEvent.create({ data: { action: "driver.document_updated", entityType: "Driver", entityId: driver.driverId } });
}

/**
 * "Já paguei": consulta autenticada ao gateway para o pagamento do PRÓPRIO pedido. O navegador não informa
 * status algum — apenas pede uma nova consulta. Limitado para não consumir a cota de requisições do provedor.
 */
export async function refreshMyPayment(driver: DriverContext | null, requestId: string) {
  requireDriver(driver);
  const r = await db.chargeRequest.findFirst({ where: { id: requestId, driverId: driver.driverId }, include: { payment: true } });
  if (!r?.payment) throw notFound("Pedido sem pagamento.");
  if (!(await hit(`pay-refresh:${driver.driverId}`, 6, 60_000))) throw new AppError("RATE_LIMITED", "Aguarde alguns segundos antes de verificar de novo.");
  const p = await refreshFromProvider(r.payment.id, getProvider(r.payment.provider));
  return { status: p.status };
}

/**
 * Verificação automática enquanto a página do pedido está aberta: o pagamento é confirmado sem o motorista
 * tocar em nada, mesmo sem webhook. No máximo uma consulta ao gateway a cada 10 s por pagamento; falhas de
 * rede só são registradas (a próxima atualização da página tenta de novo).
 */
export async function syncPendingPayment(driver: DriverContext | null, requestId: string) {
  requireDriver(driver);
  const r = await db.chargeRequest.findFirst({ where: { id: requestId, driverId: driver.driverId, status: "AWAITING_PAYMENT" }, include: { payment: true } });
  if (!r?.payment || r.payment.status !== "PENDING" || !r.payment.providerRef) return;
  if (!(await hit(`pay-auto:${r.payment.id}`, 1, 10_000))) return;
  try {
    await refreshFromProvider(r.payment.id, getProvider(r.payment.provider));
  } catch (e) {
    log.warn("payment_auto_sync_failed", { paymentId: r.payment.id, error: e instanceof Error ? e.message : String(e) });
  }
}
