/**
 * Processamento das mensagens OCPP 1.6-J recebidas de um carregador.
 *
 * Garantias:
 * - Idempotência: (estação, direção, UniqueId) é único no log. Uma mensagem repetida devolve a
 *   mesma resposta já registrada, sem reprocessar.
 * - Retentativa de StartTransaction com novo UniqueId (mesmo conector, horário e idTag) devolve o
 *   mesmo transactionId — não cria sessão duplicada.
 * - Ordem: status é ordenado pelo horário do próprio carregador; evento mais antigo que o atual
 *   fica no histórico (applied=false) e não sobrescreve o status vigente.
 * - Relógio: horário do carregador > horário do servidor + 60 s indica relógio adiantado
 *   (registrado em clockSkewMs). "Sem comunicação" é sempre medido pelo relógio do servidor.
 */
import { Prisma, type ChargingStation, type StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { OcppError, SUPPORTED_INCOMING, STATUS_MAP, isSupported, readSample, type OcppErrorCode } from "./protocol";

/** Ganchos do fluxo de recarga (vincular motorista/pagamento e apurar valor). Falhas não afetam a resposta OCPP. */
export interface SessionHooks {
  onStarted?(station: ChargingStation, sessionId: string): Promise<void>;
  onStopped?(sessionId: string): Promise<void>;
}

export type CallOutcome = { result: Record<string, unknown> } | { error: { code: OcppErrorCode; description: string } };

/** Autorização de idTag. Ainda não há cadastro de motoristas/cartões (P07): produção recusa tudo. */
export interface IdTagAuthorizer {
  authorize(idTag: string, station: Pick<ChargingStation, "environment">): Promise<"Accepted" | "Invalid" | "Blocked">;
}
export const defaultAuthorizer: IdTagAuthorizer = {
  async authorize(idTag, station) {
    if (station.environment === "PRODUCTION") return "Invalid"; // sem fonte de autorização configurada
    return /^(SIM|TEST)-/.test(idTag) ? "Accepted" : "Invalid";
  },
};

const SKEW_TOLERANCE_MS = 60_000;

export async function handleCall(
  station: ChargingStation,
  messageId: string,
  action: string,
  payload: unknown,
  opts: { now?: Date; authorizer?: IdTagAuthorizer; hooks?: SessionHooks } = {},
): Promise<CallOutcome> {
  const now = opts.now ?? new Date();
  const authorizer = opts.authorizer ?? defaultAuthorizer;

  // 1) Duplicata? Devolve a resposta registrada.
  const existing = await db.ocppMessage.findUnique({ where: { stationId_direction_messageId: { stationId: station.id, direction: "IN", messageId } } });
  if (existing) {
    if (existing.response) return existing.response as unknown as CallOutcome;
    return { error: { code: "GenericError", description: "Mensagem duplicada ainda em processamento." } };
  }

  let logRow;
  try {
    logRow = await db.ocppMessage.create({
      data: { stationId: station.id, direction: "IN", messageId, action, payload: payload as Prisma.InputJsonValue, receivedAt: now },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return handleCall(station, messageId, action, payload, opts);
    throw e;
  }

  let outcome: CallOutcome;
  let anomaly: string | undefined;
  try {
    if (!isSupported(action)) throw new OcppError("NotImplemented", `Ação ${action} não suportada por este CSMS.`);
    const parsed = SUPPORTED_INCOMING[action].safeParse(payload);
    if (!parsed.success) throw new OcppError("FormationViolation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const r = await process(station, action, parsed.data as never, now, authorizer);
    outcome = { result: r.result };
    anomaly = r.anomaly;
    try {
      if (r.startedSessionId && opts.hooks?.onStarted) await opts.hooks.onStarted(station, r.startedSessionId);
      if (r.stoppedSessionId && opts.hooks?.onStopped) await opts.hooks.onStopped(r.stoppedSessionId);
    } catch (e) {
      log.error("ocpp_session_hook_failed", { station: station.ocppIdentity, action, error: e instanceof Error ? e.message : String(e) });
    }
  } catch (e) {
    if (e instanceof OcppError) outcome = { error: { code: e.code, description: e.message } };
    else {
      log.error("ocpp_handler_failed", { station: station.ocppIdentity, action, error: e instanceof Error ? e.message : String(e) });
      outcome = { error: { code: "InternalError", description: "Erro interno ao processar a mensagem." } };
    }
  }

  await db.ocppMessage.update({
    where: { id: logRow.id },
    data: { response: outcome as unknown as Prisma.InputJsonValue, error: "error" in outcome ? `${outcome.error.code}: ${outcome.error.description}` : anomaly },
  });
  await touch(station, now);
  return outcome;
}

/** Qualquer mensagem é evidência de comunicação; sessões marcadas como sem comunicação voltam a ativas. */
async function touch(station: ChargingStation, now: Date) {
  await db.chargingStation.update({ where: { id: station.id }, data: { lastSeenAt: now, connectionState: "CONNECTED" } });
  await db.chargingSession.updateMany({ where: { stationId: station.id, status: "COMMUNICATION_LOST" }, data: { status: "ACTIVE" } });
}

async function noteSkew(station: ChargingStation, chargerTime: Date | undefined, now: Date) {
  if (!chargerTime) return;
  const ahead = chargerTime.getTime() - now.getTime();
  if (ahead > SKEW_TOLERANCE_MS) await db.chargingStation.update({ where: { id: station.id }, data: { clockSkewMs: ahead } });
}

type In<A extends keyof typeof SUPPORTED_INCOMING> = import("zod").infer<(typeof SUPPORTED_INCOMING)[A]>;

async function process(
  station: ChargingStation,
  action: keyof typeof SUPPORTED_INCOMING,
  p: never,
  now: Date,
  authorizer: IdTagAuthorizer,
): Promise<{ result: Record<string, unknown>; anomaly?: string; startedSessionId?: string; stoppedSessionId?: string }> {
  switch (action) {
    case "BootNotification": {
      const b = p as In<"BootNotification">;
      await db.chargingStation.update({
        where: { id: station.id },
        data: {
          vendor: b.chargePointVendor,
          model: b.chargePointModel,
          serialNumber: b.chargePointSerialNumber ?? b.chargeBoxSerialNumber ?? station.serialNumber,
          firmwareVersion: b.firmwareVersion ?? station.firmwareVersion,
          lastBootAt: now,
        },
      });
      return { result: { status: "Accepted", currentTime: now.toISOString(), interval: station.heartbeatInterval } };
    }
    case "Heartbeat":
      return { result: { currentTime: now.toISOString() } };

    case "StatusNotification": {
      const s = p as In<"StatusNotification">;
      await noteSkew(station, s.timestamp, now);
      if (s.connectorId === 0) {
        // Status do controlador principal: registrado no log de mensagens; não altera conectores.
        return { result: {}, anomaly: s.status !== "Available" ? `Conector 0 (estação) reportou ${s.status}/${s.errorCode}` : undefined };
      }
      const status = STATUS_MAP[s.status];
      const chargerTime = s.timestamp ?? now;
      return db.$transaction(async (tx) => {
        let connector = await tx.connector.findUnique({ where: { stationId_connectorId: { stationId: station.id, connectorId: s.connectorId } } });
        let anomaly: string | undefined;
        if (!connector) {
          connector = await tx.connector.create({ data: { stationId: station.id, connectorId: s.connectorId, maxPowerKw: 0, type: "OTHER" } });
          anomaly = `Conector ${s.connectorId} não cadastrado: criado com cadastro incompleto.`;
        }
        const applies = !connector.statusAt || chargerTime >= connector.statusAt;
        await tx.connectorStatusEvent.create({
          data: { connectorPk: connector.id, status, errorCode: s.errorCode === "NoError" ? null : s.errorCode, chargerTime: s.timestamp ?? null, receivedAt: now, applied: applies },
        });
        if (applies) {
          await tx.connector.update({
            where: { id: connector.id },
            data: { status, errorCode: s.errorCode === "NoError" ? null : s.errorCode, statusAt: chargerTime, statusReceivedAt: now },
          });
        } else {
          anomaly = `Status fora de ordem (${chargerTime.toISOString()} < ${connector.statusAt!.toISOString()}): mantido no histórico, não aplicado.`;
        }
        return { result: {}, anomaly };
      });
    }

    case "Authorize": {
      const a = p as In<"Authorize">;
      return { result: { idTagInfo: { status: await authorizer.authorize(a.idTag, station) } } };
    }

    case "StartTransaction": {
      const st = p as In<"StartTransaction">;
      await noteSkew(station, st.timestamp, now);
      const auth = await authorizer.authorize(st.idTag, station);
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ocpp-tx:" + station.id}))`;
        const retry = await tx.chargingSession.findUnique({
          where: { stationId_connectorId_startedAt_idTag: { stationId: station.id, connectorId: st.connectorId, startedAt: st.timestamp, idTag: st.idTag } },
        });
        if (retry) return { result: { transactionId: retry.transactionId, idTagInfo: { status: auth } }, anomaly: "Retentativa de StartTransaction: sessão existente reaproveitada." };
        const last = await tx.chargingSession.aggregate({ where: { stationId: station.id }, _max: { transactionId: true } });
        const transactionId = (last._max.transactionId ?? 0) + 1;
        const rejected = auth !== "Accepted";
        const created = await tx.chargingSession.create({
          data: {
            stationId: station.id,
            connectorId: st.connectorId,
            transactionId,
            idTag: st.idTag,
            environment: station.environment as StationEnvironment,
            meterStartWh: st.meterStart,
            lastMeterWh: st.meterStart,
            startedAt: st.timestamp,
            ...(rejected ? { status: "COMPLETED", stoppedAt: st.timestamp, meterStopWh: st.meterStart, stopReason: `AUTH_${auth.toUpperCase()}` } : {}),
          },
        });
        return { result: { transactionId, idTagInfo: { status: auth } }, anomaly: rejected ? `idTag ${auth}: sessão encerrada sem fornecimento.` : undefined, startedSessionId: created.id };
      });
    }

    case "StopTransaction": {
      const sp = p as In<"StopTransaction">;
      await noteSkew(station, sp.timestamp, now);
      const session = await db.chargingSession.findUnique({ where: { stationId_transactionId: { stationId: station.id, transactionId: sp.transactionId } } });
      if (!session) return { result: { idTagInfo: { status: "Accepted" } }, anomaly: `StopTransaction para transação desconhecida ${sp.transactionId}.` };
      if (sp.transactionData) await storeMeterValues(session.id, sp.transactionData);
      if (session.status === "COMPLETED") return { result: { idTagInfo: { status: "Accepted" } }, anomaly: "StopTransaction repetido: sessão já encerrada." };
      const inconsistent = sp.meterStop < session.meterStartWh;
      await db.chargingSession.update({
        where: { id: session.id },
        data: { meterStopWh: sp.meterStop, lastMeterWh: sp.meterStop, stoppedAt: sp.timestamp, stopReason: sp.reason ?? "Local", status: "COMPLETED" },
      });
      return { result: { idTagInfo: { status: "Accepted" } }, anomaly: inconsistent ? "meterStop menor que meterStart: energia inconsistente." : undefined, stoppedSessionId: session.id };
    }

    case "MeterValues": {
      const mv = p as In<"MeterValues">;
      if (mv.transactionId === undefined) return { result: {} };
      const session = await db.chargingSession.findUnique({ where: { stationId_transactionId: { stationId: station.id, transactionId: mv.transactionId } } });
      if (!session) return { result: {}, anomaly: `MeterValues para transação desconhecida ${mv.transactionId}.` };
      await storeMeterValues(session.id, mv.meterValue);
      return { result: {} };
    }
  }
}

async function storeMeterValues(sessionId: string, values: { timestamp: Date; sampledValue: Parameters<typeof readSample>[0] }[]) {
  for (const v of values) {
    const energyWh = readSample(v.sampledValue, "Energy.Active.Import.Register");
    const powerW = readSample(v.sampledValue, "Power.Active.Import");
    await db.sessionMeasurement.upsert({
      where: { sessionId_timestamp: { sessionId, timestamp: v.timestamp } },
      create: { sessionId, timestamp: v.timestamp, energyWh, powerW },
      update: {},
    });
  }
  // Registro mais recente pelo horário da medição (não pela ordem de chegada).
  const latest = await db.sessionMeasurement.findFirst({ where: { sessionId, energyWh: { not: null } }, orderBy: { timestamp: "desc" } });
  if (latest?.energyWh !== null && latest?.energyWh !== undefined) {
    await db.chargingSession.updateMany({ where: { id: sessionId, status: { not: "COMPLETED" } }, data: { lastMeterWh: latest.energyWh } });
  }
}

/**
 * Varredura de conectividade (relógio do servidor): estação sem mensagens além de 2 × heartbeat + margem
 * passa a DISCONNECTED, conectores ficam UNKNOWN e sessões ativas viram COMMUNICATION_LOST.
 */
export async function sweepConnectivity(now = new Date(), graceMs = 60_000) {
  const candidates = await db.chargingStation.findMany({ where: { connectionState: "CONNECTED", deletedAt: null } });
  let marked = 0;
  for (const s of candidates) {
    if (s.lastSeenAt && now.getTime() - s.lastSeenAt.getTime() <= 2 * s.heartbeatInterval * 1000 + graceMs) continue;
    await markDisconnected(s.id, now);
    marked++;
  }
  return marked;
}

export async function markDisconnected(stationId: string, now = new Date()) {
  await db.$transaction(async (tx) => {
    await tx.chargingStation.update({ where: { id: stationId }, data: { connectionState: "DISCONNECTED" } });
    const connectors = await tx.connector.findMany({ where: { stationId } });
    for (const c of connectors) {
      if (c.status === "UNKNOWN") continue;
      await tx.connectorStatusEvent.create({ data: { connectorPk: c.id, status: "UNKNOWN", errorCode: "COMMUNICATION_LOST", receivedAt: now, applied: true } });
      // statusAt nulo: o próximo StatusNotification após reconexão é aplicado mesmo com relógio do carregador atrasado.
      await tx.connector.update({ where: { id: c.id }, data: { status: "UNKNOWN", statusAt: null, statusReceivedAt: now } });
    }
    await tx.chargingSession.updateMany({ where: { stationId, status: "ACTIVE" }, data: { status: "COMMUNICATION_LOST" } });
  });
}
