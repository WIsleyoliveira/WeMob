/**
 * Servidor OCPP 1.6-J sobre WebSocket (processo separado da aplicação web).
 * URL: ws(s)://host:PORT/ocpp/{ocppIdentity} · subprotocolo "ocpp1.6" · HTTP Basic (identidade:senha).
 * Em produção, termine TLS (wss) num proxy: Basic sem TLS expõe a senha do carregador.
 */
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { verifyPassword } from "@/server/auth/password";
import { handleCall, markDisconnected, sweepConnectivity, type IdTagAuthorizer, type SessionHooks } from "./handler";
import { OCPP16_SUBPROTOCOL, OcppError, REMOTE_ACTIONS, callFrame, errorFrame, parseFrame, resultFrame } from "./protocol";

const COMMAND_TIMEOUT_MS = 30_000;

export interface OcppServerOptions {
  port: number;
  host?: string;
  authorizer?: IdTagAuthorizer;
  hooks?: SessionHooks;
  /** Tarefas periódicas extras (ex.: expirar pedidos de recarga, reprocessar webhooks). */
  onSweep?: () => Promise<unknown>;
  pollMs?: number;
  sweepMs?: number;
}

export function startOcppServer(opts: OcppServerOptions) {
  const sockets = new Map<string, { ws: WebSocket; stationId: string }>();
  const http = createServer((_req, res) => {
    res.writeHead(426).end("Use WebSocket (OCPP 1.6-J).");
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => (protocols.has(OCPP16_SUBPROTOCOL) ? OCPP16_SUBPROTOCOL : false),
  });

  http.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const reject = (code: number, msg: string) => {
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const match = /^\/ocpp\/([A-Za-z0-9._:-]{1,48})\/?$/.exec(new URL(req.url ?? "", "http://x").pathname);
      if (!match) return reject(404, "Not Found");
      const identity = decodeURIComponent(match[1]);
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
      if (!protocols.includes(OCPP16_SUBPROTOCOL)) return reject(400, "Subprotocol ocpp1.6 required");
      const station = await db.chargingStation.findUnique({ where: { ocppIdentity: identity } });
      const auth = String(req.headers.authorization ?? "");
      const decoded = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString() : "";
      const sep = decoded.indexOf(":");
      const [user, pass] = sep >= 0 ? [decoded.slice(0, sep), decoded.slice(sep + 1)] : [undefined, undefined];
      const ok = !!station && !station.deletedAt && station.protocol === "OCPP16J" && !!station.authSecretHash && user === identity && (await verifyPassword(pass ?? "", station.authSecretHash));
      if (!ok) {
        log.warn("ocpp_auth_rejected", { identity });
        return reject(401, "Unauthorized");
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, station!.id, identity));
    } catch (e) {
      log.error("ocpp_upgrade_failed", { error: e instanceof Error ? e.message : String(e) });
      reject(500, "Internal Error");
    }
  });

  function onConnection(ws: WebSocket, stationId: string, identity: string) {
    const previous = sockets.get(identity);
    if (previous) previous.ws.close(1000, "Nova conexão da mesma estação");
    sockets.set(identity, { ws, stationId });
    log.info("ocpp_connected", { identity });
    void db.chargingStation.update({ where: { id: stationId }, data: { connectionState: "CONNECTED", lastSeenAt: new Date() } });

    ws.on("message", async (data) => {
      const raw = data.toString();
      let frame;
      try {
        frame = parseFrame(raw);
      } catch (e) {
        if (e instanceof OcppError) ws.send(errorFrame(e.messageId ?? "-1", e.code, e.message));
        return;
      }
      if (frame.type === "CALL") {
        const station = await db.chargingStation.findUniqueOrThrow({ where: { id: stationId } });
        const out = await handleCall(station, frame.id, frame.action, frame.payload, { authorizer: opts.authorizer, hooks: opts.hooks });
        ws.send("result" in out ? resultFrame(frame.id, out.result) : errorFrame(frame.id, out.error.code, out.error.description));
        return;
      }
      // Resposta a comando enviado pelo CSMS.
      const cmd = await db.remoteCommand.findUnique({ where: { ocppMessageId: frame.id } });
      if (!cmd || cmd.stationId !== stationId || cmd.status !== "SENT") return; // resposta atrasada/duplicada: ignorada
      const st = frame.type === "RESULT" ? String((frame.payload as { status?: string })?.status ?? "") : "";
      const accepted = ["Accepted", "Unlocked", "Scheduled"].includes(st);
      await db.remoteCommand.update({
        where: { id: cmd.id },
        data: {
          status: frame.type === "ERROR" ? "FAILED" : accepted ? "ACCEPTED" : "REJECTED",
          response: (frame.type === "RESULT" ? frame.payload : { code: frame.code, description: frame.description }) as object,
          completedAt: new Date(),
        },
      });
      await db.ocppMessage.updateMany({ where: { stationId, direction: "OUT", messageId: frame.id }, data: { response: (frame.type === "RESULT" ? frame.payload : { error: frame.code }) as object } });
    });

    ws.on("close", () => {
      if (sockets.get(identity)?.ws === ws) {
        sockets.delete(identity);
        log.info("ocpp_disconnected", { identity });
        void markDisconnected(stationId);
      }
    });
  }

  // Entrega de comandos pendentes (fila durável no banco) e expiração dos sem resposta.
  const dispatch = setInterval(async () => {
    try {
      const pending = await db.remoteCommand.findMany({ where: { status: "PENDING", station: { ocppIdentity: { in: [...sockets.keys()] } } }, include: { station: true }, take: 50 });
      for (const cmd of pending) {
        const conn = sockets.get(cmd.station.ocppIdentity);
        if (!conn) continue;
        const id = randomUUID();
        const claimed = await db.remoteCommand.updateMany({ where: { id: cmd.id, status: "PENDING" }, data: { status: "SENT", ocppMessageId: id, sentAt: new Date() } });
        if (claimed.count !== 1) continue;
        await db.ocppMessage.create({ data: { stationId: cmd.stationId, direction: "OUT", messageId: id, action: REMOTE_ACTIONS[cmd.type], payload: cmd.payload as object } });
        conn.ws.send(callFrame(id, REMOTE_ACTIONS[cmd.type], cmd.payload));
      }
      await db.remoteCommand.updateMany({ where: { status: "SENT", sentAt: { lt: new Date(Date.now() - COMMAND_TIMEOUT_MS) } }, data: { status: "TIMEOUT", completedAt: new Date() } });
    } catch (e) {
      log.error("ocpp_dispatch_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }, opts.pollMs ?? 1000);

  const sweep = setInterval(() => {
    void sweepConnectivity().catch((e) => log.error("ocpp_sweep_failed", { error: String(e) }));
    if (opts.onSweep) void opts.onSweep().catch((e) => log.error("ocpp_extra_sweep_failed", { error: String(e) }));
  }, opts.sweepMs ?? 30_000);

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    http.listen(opts.port, opts.host ?? "0.0.0.0", () => {
      const addr = http.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      log.info("ocpp_server_listening", { port });
      resolve({
        port,
        close: async () => {
          clearInterval(dispatch);
          clearInterval(sweep);
          for (const { ws } of sockets.values()) ws.terminate();
          await new Promise<void>((r) => wss.close(() => r()));
          await new Promise<void>((r) => http.close(() => r()));
        },
      });
    });
  });
}
