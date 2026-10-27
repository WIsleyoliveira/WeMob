import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { notFound, AppError } from "@/server/errors";
import { effectiveStatus, isStationFresh, type ConnectorStatus } from "@/domain/stations/status";
import { currentTariff, sessionEnergyWh } from "@/server/modules/stations/service";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { requireDriver, type DriverContext } from "./auth";
import { sessionAmount } from "./charging";

export async function getProfile(driver: DriverContext | null) {
  requireDriver(driver);
  return db.driver.findUniqueOrThrow({
    where: { id: driver.driverId },
    select: { id: true, name: true, email: true, phone: true, createdAt: true, vehicles: { orderBy: { createdAt: "asc" } }, idTags: { where: { revokedAt: null }, select: { idTag: true, kind: true } } },
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

export async function removeVehicle(driver: DriverContext | null, vehicleId: string) {
  requireDriver(driver);
  const r = await db.vehicle.deleteMany({ where: { id: vehicleId, driverId: driver.driverId } });
  if (r.count === 0) throw notFound("Veículo não encontrado.");
}

/**
 * Estações visíveis ao motorista. "real": unidades públicas com equipamento de produção.
 * "demo": estações SIMULADAS (ambiente de demonstração, sem cobrança).
 */
export async function listDriverStations(mode: "real" | "demo") {
  const now = new Date();
  const stations = await db.chargingStation.findMany({
    where: mode === "demo" ? { environment: "SIMULATED", deletedAt: null } : { environment: "PRODUCTION", deletedAt: null, site: { isPublic: true, deletedAt: null } },
    include: { connectors: { orderBy: { connectorId: "asc" } }, site: { include: { tariffs: true } } },
    orderBy: { ocppIdentity: "asc" },
  });
  return stations.map((s) => ({
    id: s.id,
    identity: s.ocppIdentity,
    environment: s.environment,
    site: { name: s.site.name, address: s.site.address, city: s.site.city, state: s.site.state, openingHours: s.site.openingHours, latitude: s.site.latitude?.toString() ?? null, longitude: s.site.longitude?.toString() ?? null },
    fresh: isStationFresh(s, now),
    lastSeenAt: s.lastSeenAt,
    tariff: currentTariff(s.site.tariffs, now),
    connectors: s.connectors.map((c) => ({ connectorId: c.connectorId, type: c.type, maxPowerKw: c.maxPowerKw.toString(), status: effectiveStatus(c as { status: ConnectorStatus }, s, now).status, statusReceivedAt: c.statusReceivedAt })),
  }));
}

export async function getDriverStation(identity: string) {
  const s = await db.chargingStation.findUnique({ where: { ocppIdentity: identity }, include: { site: true } });
  if (!s || s.deletedAt) throw notFound("Estação não encontrada.");
  const mode = s.environment === "SIMULATED" ? "demo" : "real";
  const found = (await listDriverStations(mode)).find((x) => x.identity === identity);
  if (!found) throw notFound("Estação não encontrada.");
  return found;
}

export async function listMySessions(driver: DriverContext | null) {
  requireDriver(driver);
  return db.chargingSession.findMany({
    where: { driverId: driver.driverId },
    include: { station: { select: { ocppIdentity: true, site: { select: { name: true } } } }, payments: { select: { status: true, amountCaptured: true, amountRefunded: true, environment: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
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
  return {
    session: s,
    energyKwh: sessionEnergyWh(s) / 1000,
    minutes: calc.minutes.toNumber(),
    amount: calc.amount.toFixed(2),
    amountKind: live ? ("ESTIMATED" as const) : ("COMPUTED" as const),
    payment: s.payments[0] ?? null,
    demo: s.environment === "SIMULATED",
    lastPowerW: s.measurements[0]?.powerW ?? null,
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
  const d = z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(10, "Descreva o problema.").max(3000), sessionId: z.string().optional() }).parse(raw);
  if (d.sessionId && !(await db.chargingSession.findFirst({ where: { id: d.sessionId, driverId: driver.driverId } }))) throw notFound("Sessão não encontrada.");
  return db.supportRequest.create({ data: { ...d, driverId: driver.driverId } });
}

export async function listMySupport(driver: DriverContext | null) {
  requireDriver(driver);
  return db.supportRequest.findMany({ where: { driverId: driver.driverId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getMyChargeRequest(driver: DriverContext | null, id: string) {
  requireDriver(driver);
  return db.chargeRequest.findFirst({ where: { id, driverId: driver.driverId }, include: { payment: true } });
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
  const { password } = z.object({ password: z.string().min(1).max(128), confirm: z.literal(true, { errorMap: () => ({ message: "Confirme a exclusão." }) }) }).parse(raw);
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
