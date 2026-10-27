import { z } from "zod";
import type { Prisma, StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { newToken } from "@/server/crypto";
import { hashPassword } from "@/server/auth/password";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { connectorTimeShares, effectiveStatus, isStationFresh, type ConnectorStatus } from "@/domain/stations/status";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

/** Escopo: operadora vê as suas; investidor/parceiro vê apenas estações das unidades vinculadas. */
function stationScope(ctx: AuthContext): Prisma.ChargingStationWhereInput {
  return ctx.orgKind === "OPERATOR" ? { operatorId: ctx.organizationId, deletedAt: null } : { site: { partnerOrganizationId: ctx.organizationId }, deletedAt: null };
}
function siteScope(ctx: AuthContext): Prisma.SiteWhereInput {
  return ctx.orgKind === "OPERATOR" ? { operatorId: ctx.organizationId, deletedAt: null } : { partnerOrganizationId: ctx.organizationId, deletedAt: null };
}

export const siteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: opt(250),
  city: opt(120),
  state: z.preprocess((v) => (typeof v === "string" && v ? v.toUpperCase() : undefined), z.enum(UFS).optional()),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  openingHours: opt(200),
  status: z.enum(["PROSPECT", "IMPLEMENTATION", "OPERATING", "SUSPENDED"]).default("PROSPECT"),
  isPublic: z.boolean().default(false),
  partnerOrganizationId: z.string().optional().transform((v) => v || undefined),
}).refine((s) => (s.latitude === undefined) === (s.longitude === undefined), { message: "Informe latitude e longitude juntas.", path: ["latitude"] });

export async function createSite(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const d = siteSchema.parse(raw);
  if (d.partnerOrganizationId && !(await db.organization.findFirst({ where: { id: d.partnerOrganizationId, kind: { in: ["PARTNER", "INVESTOR"] }, deletedAt: null } })))
    throw notFound("Organização parceira não encontrada.");
  const site = await db.site.create({ data: { ...d, operatorId: ctx.organizationId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "site.created", entityType: "Site", entityId: site.id });
  return site;
}

export async function updateSite(ctx: AuthContext | null, siteId: string, raw: unknown) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const d = siteSchema.parse(raw);
  const site = await db.site.findFirst({ where: { id: siteId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!site) throw notFound("Unidade não encontrada.");
  await db.site.update({ where: { id: site.id }, data: { ...d, latitude: d.latitude ?? null, longitude: d.longitude ?? null } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "site.updated", entityType: "Site", entityId: site.id, data: { before: { status: site.status, name: site.name }, after: { status: d.status, name: d.name } } });
}

export async function listPartnerOrgs(ctx: AuthContext | null) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  return db.organization.findMany({ where: { kind: { in: ["PARTNER", "INVESTOR"] }, deletedAt: null }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } });
}

export async function getSiteDetail(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "site:read");
  const site = await db.site.findFirst({
    where: { id, ...siteScope(ctx) },
    include: {
      partnerOrganization: { select: { id: true, name: true, kind: true } },
      stations: { where: { deletedAt: null }, include: { connectors: { orderBy: { connectorId: "asc" } } }, orderBy: { ocppIdentity: "asc" } },
      tariffs: { orderBy: { validFrom: "desc" }, take: 10 },
    },
  });
  if (!site) throw notFound("Unidade não encontrada.");
  return site;
}

export const stationSchema = z.object({
  siteId: z.string().min(1),
  ocppIdentity: z.string().trim().regex(/^[A-Za-z0-9._:-]{3,48}$/, "Use 3–48 caracteres: letras, números, ponto, hífen, dois-pontos ou sublinhado."),
  environment: z.enum(["PRODUCTION", "TEST", "SIMULATED"]),
  protocol: z.enum(["OCPP16J", "OCPP201", "NONE"]).default("OCPP16J"),
  vendor: opt(50),
  model: opt(50),
  serialNumber: opt(50),
  heartbeatInterval: z.coerce.number().int().min(30).max(3600).default(300),
});

/** Cria estação e devolve a senha OCPP UMA ÚNICA VEZ (só o hash é persistido). */
export async function createStation(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const d = stationSchema.parse(raw);
  const site = await db.site.findFirst({ where: { id: d.siteId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!site) throw notFound("Unidade não encontrada.");
  if (await db.chargingStation.findUnique({ where: { ocppIdentity: d.ocppIdentity } })) throw new AppError("CONFLICT", "Identidade OCPP já cadastrada.");
  const secret = newToken().slice(0, 32);
  const station = await db.chargingStation.create({ data: { ...d, operatorId: ctx.organizationId, authSecretHash: d.protocol === "OCPP16J" ? await hashPassword(secret) : null } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "station.created", entityType: "ChargingStation", entityId: station.id, data: { environment: d.environment } });
  return { station, secret: d.protocol === "OCPP16J" ? secret : null };
}

export async function rotateStationSecret(ctx: AuthContext | null, stationId: string) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const st = await db.chargingStation.findFirst({ where: { id: stationId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!st) throw notFound("Estação não encontrada.");
  const secret = newToken().slice(0, 32);
  await db.chargingStation.update({ where: { id: st.id }, data: { authSecretHash: await hashPassword(secret) } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "station.secret_rotated", entityType: "ChargingStation", entityId: st.id });
  return secret;
}

export const connectorSchema = z.object({
  stationId: z.string(),
  connectorId: z.coerce.number().int().min(1).max(99),
  type: z.enum(["CCS2", "TYPE2", "CHADEMO", "GBT", "OTHER"]),
  maxPowerKw: z.coerce.number().gt(0).max(1000),
});

export async function upsertConnector(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const d = connectorSchema.parse(raw);
  const st = await db.chargingStation.findFirst({ where: { id: d.stationId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!st) throw notFound("Estação não encontrada.");
  // Status nunca é definido pelo cadastro: só por evidência do carregador.
  await db.connector.upsert({
    where: { stationId_connectorId: { stationId: st.id, connectorId: d.connectorId } },
    create: { stationId: st.id, connectorId: d.connectorId, type: d.type, maxPowerKw: d.maxPowerKw },
    update: { type: d.type, maxPowerKw: d.maxPowerKw },
  });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "connector.saved", entityType: "ChargingStation", entityId: st.id, data: d });
}

export const tariffSchema = z.object({
  siteId: z.string(),
  pricePerKwh: z.coerce.number().gt(0).max(100),
  pricePerMin: z.coerce.number().min(0).max(100).default(0),
  validFrom: z.coerce.date(),
});

/** Tarifas são versionadas por vigência: nova linha, nunca edição da anterior. */
export async function addTariff(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "site:write");
  requireOperator(ctx);
  const d = tariffSchema.parse(raw);
  const site = await db.site.findFirst({ where: { id: d.siteId, operatorId: ctx.organizationId, deletedAt: null } });
  if (!site) throw notFound("Unidade não encontrada.");
  const t = await db.tariff.create({ data: { ...d, createdById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "tariff.created", entityType: "Site", entityId: site.id, data: { pricePerKwh: d.pricePerKwh, validFrom: d.validFrom.toISOString() } });
  return t;
}

export function currentTariff<T extends { validFrom: Date }>(tariffs: T[], now = new Date()) {
  return tariffs.filter((t) => t.validFrom <= now).sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null;
}

export async function listStations(ctx: AuthContext | null) {
  requirePermission(ctx, "site:read");
  const now = new Date();
  const stations = await db.chargingStation.findMany({
    where: stationScope(ctx),
    include: { site: { select: { id: true, name: true, city: true, state: true } }, connectors: { orderBy: { connectorId: "asc" } } },
    orderBy: [{ environment: "asc" }, { ocppIdentity: "asc" }],
  });
  return stations.map((s) => ({ ...s, fresh: isStationFresh(s, now), connectors: s.connectors.map((c) => ({ ...c, effective: effectiveStatus(c as { status: ConnectorStatus }, s, now) })) }));
}

export async function getStationDetail(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "site:read");
  const isOperator = ctx.orgKind === "OPERATOR";
  const s = await db.chargingStation.findFirst({
    where: { id, ...stationScope(ctx) },
    include: {
      site: true,
      connectors: { orderBy: { connectorId: "asc" }, include: { statusEvents: { orderBy: { receivedAt: "desc" }, take: 20 } } },
      sessions: { orderBy: { startedAt: "desc" }, take: 30 },
      ...(isOperator
        ? { commands: { orderBy: { createdAt: "desc" }, take: 30 }, messages: { orderBy: { receivedAt: "desc" }, take: 40 } }
        : {}),
    },
  });
  if (!s) throw notFound("Estação não encontrada.");
  const now = new Date();
  const { authSecretHash: _secret, ...safe } = s;
  return {
    ...safe,
    hasSecret: !!s.authSecretHash,
    fresh: isStationFresh(s, now),
    connectors: s.connectors.map((c) => ({ ...c, effective: effectiveStatus(c as { status: ConnectorStatus }, s, now) })),
  };
}

export const sessionEnergyWh = (s: { meterStartWh: number; meterStopWh: number | null; lastMeterWh: number | null }) =>
  Math.max(0, (s.meterStopWh ?? s.lastMeterWh ?? s.meterStartWh) - s.meterStartWh);

/**
 * Indicadores operacionais do período. Por padrão SOMENTE estações de produção; SIMULATED/TEST só
 * entram quando solicitado explicitamente (e a interface identifica).
 */
export async function operationalOverview(ctx: AuthContext | null, raw: { from: Date; to: Date; includeNonProduction?: boolean }) {
  requirePermission(ctx, "site:read");
  const { from, to } = raw;
  const envs: StationEnvironment[] = raw.includeNonProduction ? ["PRODUCTION", "TEST", "SIMULATED"] : ["PRODUCTION"];
  const now = new Date();
  const stations = await db.chargingStation.findMany({
    where: { ...stationScope(ctx), environment: { in: envs } },
    include: { connectors: true, site: { select: { name: true } } },
  });
  const ids = stations.map((s) => s.id);
  const [sessions, events, before] = await Promise.all([
    db.chargingSession.findMany({ where: { stationId: { in: ids }, startedAt: { gte: from, lte: to }, environment: { in: envs } } }),
    db.connectorStatusEvent.findMany({ where: { connector: { stationId: { in: ids } }, applied: true, receivedAt: { gt: from, lt: to } }, select: { connectorPk: true, status: true, receivedAt: true } }),
    db.connectorStatusEvent.findMany({
      where: { connector: { stationId: { in: ids } }, applied: true, receivedAt: { lte: from } },
      orderBy: { receivedAt: "desc" },
      distinct: ["connectorPk"],
      select: { connectorPk: true, status: true },
    }),
  ]);
  const prev = new Map(before.map((b) => [b.connectorPk, b.status as ConnectorStatus]));
  const statusCounts: Record<string, number> = {};
  const perConnector = stations.flatMap((s) =>
    s.connectors.map((c) => {
      const eff = effectiveStatus(c as { status: ConnectorStatus }, s, now);
      statusCounts[eff.status] = (statusCounts[eff.status] ?? 0) + 1;
      const shares = connectorTimeShares(
        events.filter((e) => e.connectorPk === c.id).map((e) => ({ status: e.status as ConnectorStatus, at: e.receivedAt })),
        from,
        to < now ? to : now,
        prev.get(c.id) ?? "UNKNOWN",
      );
      return { stationId: s.id, identity: s.ocppIdentity, site: s.site.name, environment: s.environment, connectorId: c.connectorId, status: eff.status, ...shares };
    }),
  );
  const completed = sessions.filter((x) => x.status === "COMPLETED" && !x.stopReason?.startsWith("AUTH_"));
  return {
    period: { from, to },
    computedAt: now,
    environments: envs,
    stations: { total: stations.length, communicating: stations.filter((s) => isStationFresh(s, now)).length },
    statusCounts,
    sessions: {
      started: sessions.length,
      completed: completed.length,
      active: sessions.filter((x) => x.status === "ACTIVE").length,
      communicationLost: sessions.filter((x) => x.status === "COMMUNICATION_LOST").length,
      rejected: sessions.filter((x) => x.stopReason?.startsWith("AUTH_")).length,
      energyKwhCompleted: completed.reduce((a, x) => a + sessionEnergyWh(x), 0) / 1000,
    },
    perConnector,
    alerts: [
      ...stations.filter((s) => s.connectionState !== "NEVER_CONNECTED" && !isStationFresh(s, now)).map((s) => ({ level: "critical" as const, text: `${s.ocppIdentity}: sem comunicação desde ${s.lastSeenAt?.toISOString() ?? "—"}` })),
      ...stations.flatMap((s) => s.connectors.filter((c) => c.status === "FAULTED").map((c) => ({ level: "critical" as const, text: `${s.ocppIdentity} conector ${c.connectorId}: falha ${c.errorCode ?? ""}` }))),
      ...stations.filter((s) => s.clockSkewMs && s.clockSkewMs > 60_000).map((s) => ({ level: "warning" as const, text: `${s.ocppIdentity}: relógio adiantado ~${Math.round(s.clockSkewMs! / 1000)} s` })),
      ...sessions.filter((x) => x.status === "COMMUNICATION_LOST").map((x) => ({ level: "warning" as const, text: `Sessão ${x.transactionId} sem comunicação: aguardando StopTransaction.` })),
    ],
  };
}
