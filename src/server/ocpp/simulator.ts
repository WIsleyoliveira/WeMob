/**
 * Carregador SIMULADO (cliente OCPP 1.6-J) para desenvolvimento e testes.
 * Só deve ser usado com estações cadastradas no ambiente SIMULATED — os dados gerados ficam
 * fora dos indicadores de produção.
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { OCPP16_SUBPROTOCOL, callFrame, parseFrame, resultFrame } from "./protocol";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class SimulatedChargePoint {
  private ws?: WebSocket;
  private pending = new Map<string, Pending>();
  readonly received: { action: string; payload: unknown }[] = [];
  /** Resposta automática a comandos remotos (padrão: aceita). */
  onRemote: (action: string, payload: Record<string, unknown>) => Record<string, unknown> = (action) =>
    action === "UnlockConnector" ? { status: "Unlocked" } : { status: "Accepted" };

  constructor(private url: string, private identity: string, private password: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.url}/ocpp/${encodeURIComponent(this.identity)}`, [OCPP16_SUBPROTOCOL], {
        headers: { Authorization: "Basic " + Buffer.from(`${this.identity}:${this.password}`).toString("base64") },
      });
      ws.once("open", () => resolve());
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once("error", reject);
      ws.on("message", (d) => this.onMessage(d.toString()));
      this.ws = ws;
    });
  }

  private onMessage(raw: string) {
    const f = parseFrame(raw);
    if (f.type === "CALL") {
      this.received.push({ action: f.action, payload: f.payload });
      this.ws!.send(resultFrame(f.id, this.onRemote(f.action, f.payload as Record<string, unknown>)));
      return;
    }
    const p = this.pending.get(f.id);
    if (!p) return;
    this.pending.delete(f.id);
    if (f.type === "RESULT") p.resolve(f.payload);
    else p.reject(new Error(`${f.code}: ${f.description}`));
  }

  /** Envia CALL; `id` permite reenviar a mesma mensagem (teste de duplicidade). */
  call<T = Record<string, unknown>>(action: string, payload: unknown, id: string = randomUUID()): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(callFrame(id, action, payload));
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), reject(new Error("timeout"))), 10_000);
    });
  }

  sendRaw(raw: string) {
    this.ws!.send(raw);
  }

  boot() {
    return this.call<{ status: string; interval: number }>("BootNotification", { chargePointVendor: "Sansol-Sim", chargePointModel: "SIM-60kW", firmwareVersion: "sim-1.0" });
  }
  status(connectorId: number, status: string, timestamp = new Date()) {
    return this.call("StatusNotification", { connectorId, errorCode: "NoError", status, timestamp: timestamp.toISOString() });
  }
  start(connectorId: number, idTag: string, meterStart: number, timestamp = new Date()) {
    return this.call<{ transactionId: number; idTagInfo: { status: string } }>("StartTransaction", { connectorId, idTag, meterStart, timestamp: timestamp.toISOString() });
  }
  meter(connectorId: number, transactionId: number, wh: number, timestamp = new Date()) {
    return this.call("MeterValues", { connectorId, transactionId, meterValue: [{ timestamp: timestamp.toISOString(), sampledValue: [{ value: String(wh), measurand: "Energy.Active.Import.Register", unit: "Wh" }] }] });
  }
  stop(transactionId: number, meterStop: number, timestamp = new Date(), reason = "Local") {
    return this.call("StopTransaction", { transactionId, meterStop, timestamp: timestamp.toISOString(), reason });
  }

  close(): Promise<void> {
    return new Promise((r) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return r();
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}
