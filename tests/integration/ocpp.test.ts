import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { handleCall, sweepConnectivity } from "@/server/ocpp/handler";
import { startOcppServer } from "@/server/ocpp/ws-server";
import { SimulatedChargePoint } from "@/server/ocpp/simulator";
import { createSite, createStation, getStationDetail, listStations, operationalOverview, upsertConnector } from "@/server/modules/stations/service";
import { requestRemoteCommand } from "@/server/modules/stations/commands";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

async function setup(environment: StationEnvironment = "SIMULATED") {
  const op = await bootstrapOperator();
  const admin = await createUser(op.id, "admin");
  const site = await createSite(admin.ctx, { name: "Posto Teste", city: "Belém", state: "PA" });
  const { station, secret } = await createStation(admin.ctx, { siteId: site.id, ocppIdentity: `CP-${environment}-${Date.now()}`, environment, heartbeatInterval: 60 });
  await upsertConnector(admin.ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
  const fresh = () => db.chargingStation.findUniqueOrThrow({ where: { id: station.id } });
  const call = async (id: string, action: string, payload: unknown, now?: Date) => handleCall(await fresh(), id, action, payload, { now });
  return { op, admin, site, station, secret, fresh, call };
}
const iso = (d: Date) => d.toISOString();

describe("handler OCPP — idempotência e ordem", () => {
  it("BootNotification registra dados do equipamento e responde intervalo", async () => {
    const { call, fresh } = await setup();
    const r = await call("m1", "BootNotification", { chargePointVendor: "ACME", chargePointModel: "DC60", firmwareVersion: "1.2" });
    expect(r).toMatchObject({ result: { status: "Accepted", interval: 60 } });
    expect(await fresh()).toMatchObject({ vendor: "ACME", model: "DC60", firmwareVersion: "1.2", connectionState: "CONNECTED" });
  });

  it("mensagem repetida (mesmo UniqueId) devolve a mesma resposta sem criar outra sessão", async () => {
    const { call, station } = await setup();
    const p = { connectorId: 1, idTag: "SIM-1", meterStart: 1000, timestamp: iso(new Date()) };
    const a = await call("dup-1", "StartTransaction", p);
    const b = await call("dup-1", "StartTransaction", p);
    expect(b).toEqual(a);
    expect(await db.chargingSession.count({ where: { stationId: station.id } })).toBe(1);
  });

  it("retentativa de StartTransaction com novo UniqueId reaproveita a transação", async () => {
    const { call, station } = await setup();
    const p = { connectorId: 1, idTag: "SIM-1", meterStart: 1000, timestamp: iso(new Date()) };
    const a = (await call("s1", "StartTransaction", p)) as { result: { transactionId: number } };
    const b = (await call("s2", "StartTransaction", p)) as { result: { transactionId: number } };
    expect(b.result.transactionId).toBe(a.result.transactionId);
    expect(await db.chargingSession.count({ where: { stationId: station.id } })).toBe(1);
  });

  it("status fora de ordem fica no histórico e não sobrescreve o atual", async () => {
    const { call, station } = await setup();
    const t = Date.now();
    await call("st1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging", timestamp: iso(new Date(t)) });
    await call("st2", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: iso(new Date(t - 60_000)) });
    const c = await db.connector.findUniqueOrThrow({ where: { stationId_connectorId: { stationId: station.id, connectorId: 1 } }, include: { statusEvents: true } });
    expect(c.status).toBe("CHARGING");
    expect(c.statusEvents.map((e) => [e.status, e.applied]).sort()).toEqual([["AVAILABLE", false], ["CHARGING", true]]);
  });

  it("registra relógio adiantado do carregador", async () => {
    const { call, fresh } = await setup();
    await call("ck", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: iso(new Date(Date.now() + 10 * 60_000)) });
    expect((await fresh()).clockSkewMs).toBeGreaterThan(9 * 60_000);
  });

  it("ação não suportada → NotImplemented; payload inválido → FormationViolation (ambos registrados)", async () => {
    const { call, station } = await setup();
    expect(await call("x1", "DataTransfer", { vendorId: "x" })).toMatchObject({ error: { code: "NotImplemented" } });
    expect(await call("x2", "StatusNotification", { connectorId: 1, status: "Ligado" })).toMatchObject({ error: { code: "FormationViolation" } });
    expect(await db.ocppMessage.count({ where: { stationId: station.id, error: { not: null } } })).toBe(2);
  });
});

describe("handler OCPP — sessões e autorização", () => {
  it("produção sem fonte de autorização recusa o idTag e não fornece energia", async () => {
    const { call, station } = await setup("PRODUCTION");
    const r = await call("p1", "StartTransaction", { connectorId: 1, idTag: "SIM-1", meterStart: 0, timestamp: iso(new Date()) });
    expect(r).toMatchObject({ result: { idTagInfo: { status: "Invalid" } } });
    expect(await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).toMatchObject({ status: "COMPLETED", stopReason: "AUTH_INVALID" });
  });

  it("medições fora de ordem usam o horário da medição; StopTransaction fecha e é idempotente", async () => {
    const { call, station } = await setup();
    const t0 = Date.now() - 600_000;
    const s = (await call("a", "StartTransaction", { connectorId: 1, idTag: "SIM-9", meterStart: 10_000, timestamp: iso(new Date(t0)) })) as { result: { transactionId: number } };
    const tx = s.result.transactionId;
    const mv = (wh: number, dt: number) => ({ connectorId: 1, transactionId: tx, meterValue: [{ timestamp: iso(new Date(t0 + dt)), sampledValue: [{ value: String(wh), unit: "Wh" }] }] });
    await call("m2", "MeterValues", mv(14_000, 120_000));
    await call("m1", "MeterValues", mv(12_000, 60_000)); // chega atrasada
    expect((await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).lastMeterWh).toBe(14_000);
    await call("stop1", "StopTransaction", { transactionId: tx, meterStop: 16_000, timestamp: iso(new Date(t0 + 180_000)) });
    const again = await call("stop2", "StopTransaction", { transactionId: tx, meterStop: 16_000, timestamp: iso(new Date(t0 + 180_000)) });
    expect(again).toMatchObject({ result: { idTagInfo: { status: "Accepted" } } });
    const done = await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } });
    expect(done).toMatchObject({ status: "COMPLETED", meterStopWh: 16_000 });
    expect(await db.sessionMeasurement.count({ where: { sessionId: done.id } })).toBe(2);
  });

  it("StopTransaction de transação desconhecida é aceito e registrado como anomalia", async () => {
    const { call, station } = await setup();
    expect(await call("u1", "StopTransaction", { transactionId: 999, meterStop: 1, timestamp: iso(new Date()) })).toMatchObject({ result: {} });
    expect((await db.ocppMessage.findFirstOrThrow({ where: { stationId: station.id, messageId: "u1" } })).error).toMatch(/desconhecida/);
  });
});

describe("perda de comunicação e reconexão", () => {
  it("sem telemetria: estação desconectada, conectores desconhecidos, sessão marcada; reconexão restaura", async () => {
    const { call, station, fresh } = await setup();
    await call("b", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging", timestamp: iso(new Date()) });
    const s = (await call("s", "StartTransaction", { connectorId: 1, idTag: "SIM-1", meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number } };
    await db.chargingStation.update({ where: { id: station.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await sweepConnectivity()).toBe(1);
    expect((await fresh()).connectionState).toBe("DISCONNECTED");
    expect((await db.connector.findFirstOrThrow({ where: { stationId: station.id } })).status).toBe("UNKNOWN");
    expect((await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).status).toBe("COMMUNICATION_LOST");
    // Reconexão: qualquer mensagem reativa; StopTransaction acumulado encerra a sessão.
    await call("hb", "Heartbeat", {});
    expect((await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).status).toBe("ACTIVE");
    await call("st", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 5000, timestamp: iso(new Date()) });
    expect((await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).status).toBe("COMPLETED");
  });
});

describe("comandos remotos", () => {
  it("exige permissão, comunicação, estado válido e registra bloqueios", async () => {
    const { op, admin, station, call } = await setup();
    const sales = await createUser(op.id, "commercial");
    await expect(requestRemoteCommand(sales.ctx, { type: "REMOTE_STOP", stationId: station.id, transactionId: 1 })).rejects.toThrow(/permissão/);
    await expect(requestRemoteCommand(admin.ctx, { type: "UNLOCK_CONNECTOR", stationId: station.id, connectorId: 1 })).rejects.toThrow(/sem comunicação/);
    await call("hb", "Heartbeat", {});
    await expect(requestRemoteCommand(admin.ctx, { type: "REMOTE_STOP", stationId: station.id, transactionId: 7 })).rejects.toThrow(/Não há sessão ativa/);
    await expect(requestRemoteCommand(admin.ctx, { type: "RESET", stationId: station.id, resetType: "Soft" })).rejects.toThrow(/Confirme/);
    const ok = await requestRemoteCommand(admin.ctx, { type: "RESET", stationId: station.id, resetType: "Soft", confirm: true });
    expect(ok.status).toBe("PENDING");
    expect(await db.remoteCommand.count({ where: { stationId: station.id, status: "BLOCKED" } })).toBe(2);
  });

  it("equipamento de produção: admin comum é bloqueado; sem flag de ambiente ninguém envia", async () => {
    const { op, admin, station, call } = await setup("PRODUCTION");
    await call("hb", "Heartbeat", {});
    await expect(requestRemoteCommand(admin.ctx, { type: "RESET", stationId: station.id, resetType: "Soft", confirm: true })).rejects.toThrow(/permissão específica/);
    const superadmin = await createUser(op.id, "superadmin");
    delete process.env.OCPP_ALLOW_PRODUCTION_COMMANDS;
    await expect(requestRemoteCommand(superadmin.ctx, { type: "RESET", stationId: station.id, resetType: "Soft", confirm: true })).rejects.toThrow(/desabilitados/);
  });

  it("outra organização não comanda nem lê a estação; parceiro só vê a própria unidade", async () => {
    const { op, admin, station, site } = await setup();
    const other = await createUser((await createOrg("Outra", "OPERATOR")).id, "admin");
    await expect(requestRemoteCommand(other.ctx, { type: "RESET", stationId: station.id, resetType: "Soft", confirm: true })).rejects.toThrow(/não encontrada/);
    await expect(getStationDetail(other.ctx, station.id)).rejects.toThrow(/não encontrada/);
    const pA = await createOrg("Parceiro A", "PARTNER");
    const pB = await createOrg("Parceiro B", "PARTNER");
    await db.site.update({ where: { id: site.id }, data: { partnerOrganizationId: pA.id } });
    const partnerA = await createUser(pA.id, "partner");
    const partnerB = await createUser(pB.id, "partner");
    const seen = await getStationDetail(partnerA.ctx, station.id);
    expect(seen).not.toHaveProperty("commands");
    expect(seen).not.toHaveProperty("authSecretHash");
    expect(await listStations(partnerB.ctx)).toHaveLength(0);
    await expect(requestRemoteCommand(partnerA.ctx, { type: "RESET", stationId: station.id, resetType: "Soft", confirm: true })).rejects.toThrow(/permissão/);
    void op; void admin;
  });
});

describe("indicadores separam produção de simulação", () => {
  it("sessões simuladas não entram nos indicadores padrão", async () => {
    const { admin, call } = await setup("SIMULATED");
    const s = (await call("s", "StartTransaction", { connectorId: 1, idTag: "SIM-1", meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number } };
    await call("e", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 20_000, timestamp: iso(new Date()) });
    const period = { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) };
    expect((await operationalOverview(admin.ctx, period)).sessions.completed).toBe(0);
    const all = await operationalOverview(admin.ctx, { ...period, includeNonProduction: true });
    expect(all.sessions.completed).toBe(1);
    expect(all.sessions.energyKwhCompleted).toBe(20);
  });
});

describe("servidor OCPP via WebSocket (ponta a ponta com simulador)", () => {
  let server: Awaited<ReturnType<typeof startOcppServer>> | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("autentica, processa ciclo de recarga, entrega comando e registra desconexão", async () => {
    const { admin, station, secret, fresh } = await setup();
    server = await startOcppServer({ port: 0, host: "127.0.0.1", pollMs: 100, sweepMs: 60_000 });
    const url = `ws://127.0.0.1:${server.port}`;

    await expect(new SimulatedChargePoint(url, station.ocppIdentity, "senha-errada").connect()).rejects.toThrow(/401/);

    const cp = new SimulatedChargePoint(url, station.ocppIdentity, secret!);
    await cp.connect();
    expect((await cp.boot()).status).toBe("Accepted");
    await cp.status(1, "Charging");
    const tx = await cp.start(1, "SIM-0001", 0);
    expect(tx.idTagInfo.status).toBe("Accepted");
    await cp.meter(1, tx.transactionId, 3000);

    // Mesmo UniqueId reenviado pela rede: mesma resposta.
    const r1 = await cp.call("Heartbeat", {}, "same-id-1");
    const r2 = await cp.call("Heartbeat", {}, "same-id-1");
    expect(r2).toEqual(r1);

    const cmd = await requestRemoteCommand(admin.ctx, { type: "REMOTE_STOP", stationId: station.id, transactionId: tx.transactionId });
    for (let i = 0; i < 50 && cp.received.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(cp.received[0]).toEqual({ action: "RemoteStopTransaction", payload: { transactionId: tx.transactionId } });
    let final = cmd;
    for (let i = 0; i < 50 && final.status !== "ACCEPTED"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      final = await db.remoteCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    }
    expect(final).toMatchObject({ status: "ACCEPTED", response: { status: "Accepted" } });

    await cp.stop(tx.transactionId, 6000);
    expect((await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } })).status).toBe("COMPLETED");

    await cp.close();
    for (let i = 0; i < 40 && (await fresh()).connectionState !== "DISCONNECTED"; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await fresh()).connectionState).toBe("DISCONNECTED");
  });
});
