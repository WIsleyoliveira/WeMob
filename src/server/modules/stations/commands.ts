import { z } from "zod";
import type { RemoteCommandType } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";
import { effectiveStatus, OCCUPIED } from "@/domain/stations/status";

export const COMMAND_LABEL: Record<RemoteCommandType, string> = {
  RESET: "Reiniciar carregador",
  REMOTE_START: "Iniciar recarga remota",
  REMOTE_STOP: "Encerrar recarga remota",
  UNLOCK_CONNECTOR: "Destravar conector",
  CHANGE_AVAILABILITY: "Alterar disponibilidade",
};

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("RESET"), stationId: z.string(), resetType: z.enum(["Soft", "Hard"]), confirm: z.literal(true, { errorMap: () => ({ message: "Confirme o reinício." }) }) }),
  z.object({ type: z.literal("REMOTE_START"), stationId: z.string(), connectorId: z.coerce.number().int().min(1), idTag: z.string().trim().min(1).max(20), confirm: z.boolean().optional() }),
  z.object({ type: z.literal("REMOTE_STOP"), stationId: z.string(), transactionId: z.coerce.number().int(), confirm: z.boolean().optional() }),
  z.object({ type: z.literal("UNLOCK_CONNECTOR"), stationId: z.string(), connectorId: z.coerce.number().int().min(1), confirm: z.boolean().optional() }),
  z.object({ type: z.literal("CHANGE_AVAILABILITY"), stationId: z.string(), connectorId: z.coerce.number().int().min(0), availability: z.enum(["Operative", "Inoperative"]), confirm: z.boolean().optional() }),
]);

function ocppPayload(c: z.infer<typeof commandSchema>) {
  switch (c.type) {
    case "RESET": return { type: c.resetType };
    case "REMOTE_START": return { connectorId: c.connectorId, idTag: c.idTag };
    case "REMOTE_STOP": return { transactionId: c.transactionId };
    case "UNLOCK_CONNECTOR": return { connectorId: c.connectorId };
    case "CHANGE_AVAILABILITY": return { connectorId: c.connectorId, type: c.availability };
  }
}

/**
 * Solicita comando remoto. Toda tentativa é registrada (inclusive as bloqueadas) com solicitante,
 * horário, motivo e, depois, resposta do carregador. A entrega é feita pelo servidor OCPP.
 */
export async function requestRemoteCommand(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "station:command");
  requireOperator(ctx);
  const c = commandSchema.parse(raw);
  const station = await db.chargingStation.findFirst({
    where: { id: c.stationId, operatorId: ctx.organizationId, deletedAt: null },
    include: { connectors: true, sessions: { where: { status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } } } },
  });
  if (!station) throw notFound("Estação não encontrada.");
  const payload = ocppPayload(c);

  const block = async (reason: string): Promise<never> => {
    await db.remoteCommand.create({ data: { stationId: station.id, type: c.type, payload, status: "BLOCKED", reason, requestedById: ctx.userId, completedAt: new Date() } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "station.command_blocked", entityType: "ChargingStation", entityId: station.id, data: { type: c.type, reason } });
    throw new AppError("VALIDATION", reason);
  };

  if (station.protocol !== "OCPP16J") await block("Estação sem adaptador de protocolo implementado (somente OCPP 1.6-J).");
  if (station.environment === "PRODUCTION") {
    if (!ctx.permissions.has("station:command_production")) await block("Comandos em equipamento de produção exigem permissão específica.");
    if (process.env.OCPP_ALLOW_PRODUCTION_COMMANDS !== "1") await block("Comandos em produção estão desabilitados neste ambiente (OCPP_ALLOW_PRODUCTION_COMMANDS).");
    if (c.confirm !== true) await block("Confirme explicitamente o comando em equipamento de produção.");
  }
  const now = new Date();
  if (effectiveStatus({ status: "UNKNOWN" }, station, now).stale) await block("Estação sem comunicação: o comando não pode ser entregue.");
  const connector = "connectorId" in c && c.connectorId > 0 ? station.connectors.find((x) => x.connectorId === c.connectorId) : undefined;
  if ("connectorId" in c && c.connectorId > 0 && !connector) await block(`Conector ${c.connectorId} não cadastrado.`);
  if (c.type === "REMOTE_START") {
    if (!["AVAILABLE", "PREPARING"].includes(connector!.status)) await block(`Conector ${c.connectorId} não está disponível (status atual: ${connector!.status}).`);
    if (station.sessions.some((s) => s.connectorId === c.connectorId)) await block("Já existe sessão ativa neste conector.");
  }
  if (c.type === "REMOTE_STOP" && !station.sessions.some((s) => s.transactionId === c.transactionId)) await block("Não há sessão ativa com esta transação.");
  if (c.type === "UNLOCK_CONNECTOR" && OCCUPIED.includes(connector!.status) && connector!.status !== "FINISHING") await block("Conector em uso: encerre a sessão antes de destravar.");
  const pending = await db.remoteCommand.findFirst({ where: { stationId: station.id, type: c.type, status: { in: ["PENDING", "SENT"] } } });
  if (pending) await block("Já existe um comando deste tipo aguardando resposta.");

  const cmd = await db.remoteCommand.create({ data: { stationId: station.id, type: c.type, payload, requestedById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "station.command_requested", entityType: "RemoteCommand", entityId: cmd.id, data: { type: c.type, payload } });
  return cmd;
}
