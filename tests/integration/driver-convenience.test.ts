import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { handleCall } from "@/server/ocpp/handler";
import { addTariff, createSite, createStation, upsertConnector } from "@/server/modules/stations/service";
import { listMyDevices, loginDriver, resolveDriver, revokeMyDevice, revokeOtherDevices, signupDriver } from "@/server/drivers/auth";
import { driverAwareAuthorizer, onSessionStarted, onSessionStopped, startCharge } from "@/server/drivers/charging";
import { MAX_FAVORITES, deleteMyAccount, exportMyData, getMySession, isMyFavorite, lastChargeShortcut, listMyFavorites, setFavorite } from "@/server/drivers/service";
import { DEVICE_TOUCH_INTERVAL_MS } from "@/domain/drivers/device";
import { bootstrapOperator, createUser, resetDb } from "./fixtures";

beforeAll(() => {
  process.env.PAYMENT_PROVIDER = "sandbox";
  process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET = "segredo-de-teste-sandbox";
  process.env.PAYMENT_PREAUTH_AMOUNT = "100";
});
beforeEach(resetDb);

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const PASSWORD = "senha-motorista-123";
let seq = 0;

async function setup() {
  const op = await bootstrapOperator();
  const admin = await createUser(op.id, "admin");
  const site = await createSite(admin.ctx, { name: "Posto Público", isPublic: true });
  const station = async (opts: { isPublic?: boolean } = {}) => {
    const s = opts.isPublic === false ? await createSite(admin.ctx, { name: "Posto Privado", isPublic: false }) : site;
    const { station } = await createStation(admin.ctx, { siteId: s.id, ocppIdentity: `CP-FAV-${++seq}`, environment: "TEST", heartbeatInterval: 60 });
    await upsertConnector(admin.ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
    return station;
  };
  await addTariff(admin.ctx, { siteId: site.id, pricePerKwh: 2, pricePerMin: 0, validFrom: new Date(Date.now() - 86400000) });
  const driverOf = async (name: string) => {
    const email = `${name}${++seq}@ex.com`;
    const { token } = await signupDriver({ name, email, password: PASSWORD, consent: true }, { userAgent: ANDROID_CHROME });
    return { email, token, ctx: (await resolveDriver(token))! };
  };
  return { admin, station, driverOf };
}

describe("favoritos do motorista", () => {
  it("marcar é idempotente, desmarcar remove, e cada motorista vê só os próprios", async () => {
    const { station, driverOf } = await setup();
    const st = await station();
    const ana = await driverOf("ana");
    const bia = await driverOf("bia");
    expect(await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: true })).toBe(true);
    expect(await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: true })).toBe(true); // clique duplo
    expect(await db.driverFavoriteStation.count()).toBe(1);
    expect((await listMyFavorites(ana.ctx)).map((s) => s.identity)).toEqual([st.ocppIdentity]);
    expect(await isMyFavorite(ana.ctx, st.id)).toBe(true);
    expect(await listMyFavorites(bia.ctx)).toEqual([]);
    expect(await isMyFavorite(bia.ctx, st.id)).toBe(false);
    expect(await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: false })).toBe(false);
    expect(await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: false })).toBe(false);
    expect(await db.driverFavoriteStation.count()).toBe(0);
  });

  it("não favorita estação que o motorista não pode abrir; favorita que deixa de ser acessível some da lista", async () => {
    const { station, driverOf } = await setup();
    const hidden = await station({ isPublic: false });
    const st = await station();
    const ana = await driverOf("ana");
    await expect(setFavorite(ana.ctx, { identity: hidden.ocppIdentity, favorite: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setFavorite(ana.ctx, { identity: "NAO-EXISTE", favorite: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setFavorite(null, { identity: st.ocppIdentity, favorite: true })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: true });
    await db.chargingStation.update({ where: { id: st.id }, data: { deletedAt: new Date() } });
    expect(await listMyFavorites(ana.ctx)).toEqual([]);
  });

  it(`limite de ${MAX_FAVORITES} favoritas por motorista`, async () => {
    const { station, driverOf } = await setup();
    const ana = await driverOf("ana");
    const all = [];
    for (let i = 0; i <= MAX_FAVORITES; i++) all.push(await station());
    for (const st of all.slice(0, MAX_FAVORITES)) await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: true });
    await expect(setFavorite(ana.ctx, { identity: all[MAX_FAVORITES].ocppIdentity, favorite: true })).rejects.toMatchObject({ code: "VALIDATION" });
    // repetir uma que já é favorita continua aceito no limite
    expect(await setFavorite(ana.ctx, { identity: all[0].ocppIdentity, favorite: true })).toBe(true);
    expect(await db.driverFavoriteStation.count()).toBe(MAX_FAVORITES);
  });
});

describe("repetir última recarga", () => {
  it("aponta para a última recarga INICIADA pelo carregador, só do próprio motorista, e some se a estação sair do ar", async () => {
    const { station, driverOf } = await setup();
    const st = await station();
    const call = async (id: string, action: string, payload: unknown) =>
      handleCall(await db.chargingStation.findUniqueOrThrow({ where: { id: st.id } }), id, action, payload, { authorizer: driverAwareAuthorizer, hooks: { onStarted: onSessionStarted, onStopped: onSessionStopped } });
    await call("st-1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: new Date().toISOString() });
    const ana = await driverOf("ana");
    const bia = await driverOf("bia");
    expect(await lastChargeShortcut(ana.ctx)).toBeNull();

    const req = await startCharge(ana.ctx, { identity: st.ocppIdentity, connectorId: 1 });
    expect(await lastChargeShortcut(ana.ctx)).toBeNull(); // pago, mas o carregador ainda não iniciou
    await call("start-1", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: new Date().toISOString() });
    expect(await lastChargeShortcut(ana.ctx)).toMatchObject({ identity: st.ocppIdentity, connectorId: 1, siteName: "Posto Público", environment: "TEST" });
    expect(await lastChargeShortcut(bia.ctx)).toBeNull();
    expect(await lastChargeShortcut(null)).toBeNull();

    await db.chargingStation.update({ where: { id: st.id }, data: { deletedAt: new Date() } });
    expect(await lastChargeShortcut(ana.ctx)).toBeNull();
  });
});

describe("aparelhos conectados", () => {
  it("lista só as sessões abertas do próprio motorista, com rótulo genérico e o aparelho atual marcado", async () => {
    const { driverOf } = await setup();
    const ana = await driverOf("ana");
    const bia = await driverOf("bia");
    const phone = await loginDriver({ email: ana.email, password: PASSWORD }, { userAgent: IPHONE_SAFARI });
    await loginDriver({ email: ana.email, password: PASSWORD }); // sem User-Agent
    const rows = await db.driverSession.findMany({ where: { driverId: ana.ctx.driverId } });
    expect(rows.map((r) => r.deviceLabel).sort()).toEqual(["Aparelho não identificado", "Chrome no Android", "Safari no iPhone"]);
    expect(JSON.stringify(rows)).not.toContain("SM-S918B"); // User-Agent completo não é guardado

    const list = await listMyDevices(ana.ctx);
    expect(list).toHaveLength(3);
    expect(list.filter((d) => d.current).map((d) => d.id)).toEqual([ana.ctx.sessionId]);
    expect((await listMyDevices(bia.ctx)).map((d) => d.id)).toEqual([bia.ctx.sessionId]);

    // expirada ou encerrada não aparece
    await db.driverSession.updateMany({ where: { driverId: ana.ctx.driverId, id: { not: ana.ctx.sessionId }, deviceLabel: "Aparelho não identificado" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await listMyDevices(ana.ctx)).toHaveLength(2);
    expect((await resolveDriver(phone.token))?.driverId).toBe(ana.ctx.driverId);
  });

  it("desconectar outro aparelho invalida o token dele; o atual e o de outro motorista não são aceitos", async () => {
    const { driverOf } = await setup();
    const ana = await driverOf("ana");
    const bia = await driverOf("bia");
    const phone = await loginDriver({ email: ana.email, password: PASSWORD }, { userAgent: IPHONE_SAFARI });
    const phoneCtx = (await resolveDriver(phone.token))!;

    await expect(revokeMyDevice(ana.ctx, ana.ctx.sessionId)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(revokeMyDevice(ana.ctx, bia.ctx.sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await resolveDriver(bia.token)).not.toBeNull();

    await revokeMyDevice(ana.ctx, phoneCtx.sessionId);
    expect(await resolveDriver(phone.token)).toBeNull();
    expect(await resolveDriver(ana.token)).not.toBeNull();
    await expect(revokeMyDevice(ana.ctx, phoneCtx.sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" }); // repetido
    expect(await db.auditEvent.count({ where: { action: "driver.session_revoked", entityId: ana.ctx.driverId } })).toBe(1);
  });

  it("desconectar todos os outros mantém só o aparelho atual", async () => {
    const { driverOf } = await setup();
    const ana = await driverOf("ana");
    const bia = await driverOf("bia");
    const t1 = await loginDriver({ email: ana.email, password: PASSWORD }, { userAgent: IPHONE_SAFARI });
    const t2 = await loginDriver({ email: ana.email, password: PASSWORD }, { userAgent: IPHONE_SAFARI });
    expect(await revokeOtherDevices(ana.ctx)).toBe(2);
    expect(await resolveDriver(t1.token)).toBeNull();
    expect(await resolveDriver(t2.token)).toBeNull();
    expect(await resolveDriver(ana.token)).not.toBeNull();
    expect(await resolveDriver(bia.token)).not.toBeNull();
    expect(await revokeOtherDevices(ana.ctx)).toBe(0);
  });

  it("último uso: atualiza ao usar depois de 5 min, sem gravar a cada requisição", async () => {
    const { driverOf } = await setup();
    const ana = await driverOf("ana");
    const old = new Date(Date.now() - DEVICE_TOUCH_INTERVAL_MS - 60_000);
    await db.driverSession.update({ where: { id: ana.ctx.sessionId }, data: { lastSeenAt: old } });
    await resolveDriver(ana.token);
    const touched = (await db.driverSession.findUniqueOrThrow({ where: { id: ana.ctx.sessionId } })).lastSeenAt!;
    expect(touched.getTime()).toBeGreaterThan(old.getTime());
    await resolveDriver(ana.token);
    expect((await db.driverSession.findUniqueOrThrow({ where: { id: ana.ctx.sessionId } })).lastSeenAt).toEqual(touched);
  });
});

describe("LGPD com favoritos e aparelhos", () => {
  it("a exportação inclui favoritos e aparelhos (sem token); a exclusão da conta remove os favoritos", async () => {
    const { station, driverOf } = await setup();
    const st = await station();
    const ana = await driverOf("ana");
    await setFavorite(ana.ctx, { identity: st.ocppIdentity, favorite: true });
    const out = await exportMyData(ana.ctx);
    expect(out.titular.favorites).toHaveLength(1);
    expect(out.titular.favorites[0].station.ocppIdentity).toBe(st.ocppIdentity);
    expect(out.titular.sessions[0]).toMatchObject({ deviceLabel: "Chrome no Android" });
    expect(JSON.stringify(out)).not.toMatch(/tokenHash/);
    await deleteMyAccount(ana.ctx, { password: PASSWORD, confirm: true });
    expect(await db.driverFavoriteStation.count()).toBe(0);
  });
});

describe("tela da recarga: frescor da estação", () => {
  it("getMySession informa se a estação está dentro do prazo de comunicação", async () => {
    const { station, driverOf } = await setup();
    const st = await station();
    const call = async (id: string, action: string, payload: unknown) =>
      handleCall(await db.chargingStation.findUniqueOrThrow({ where: { id: st.id } }), id, action, payload, { authorizer: driverAwareAuthorizer, hooks: { onStarted: onSessionStarted, onStopped: onSessionStopped } });
    await call("st-1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: new Date().toISOString() });
    const ana = await driverOf("ana");
    const req = await startCharge(ana.ctx, { identity: st.ocppIdentity, connectorId: 1 });
    await call("start-1", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: new Date().toISOString() });
    const session = await db.chargingSession.findFirstOrThrow({ where: { driverId: ana.ctx.driverId } });
    await db.chargingStation.update({ where: { id: st.id }, data: { connectionState: "CONNECTED", lastSeenAt: new Date() } });
    expect((await getMySession(ana.ctx, session.id)).stationFresh).toBe(true);
    // heartbeat de 60 s: 10 min sem comunicação passa do prazo (a sessão continua ACTIVE até a varredura)
    await db.chargingStation.update({ where: { id: st.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) } });
    const v = await getMySession(ana.ctx, session.id);
    expect(v.stationFresh).toBe(false);
    expect(v.session.status).toBe("ACTIVE");
  });
});
