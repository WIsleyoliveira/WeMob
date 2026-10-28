import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { handleCall } from "@/server/ocpp/handler";
import { createSite, createStation, upsertConnector, addTariff } from "@/server/modules/stations/service";
import { signupDriver, resolveDriver, loginDriver, logoutDriver } from "@/server/drivers/auth";
import { resolveSession } from "@/server/auth/session";
import { cancelChargeRequest, driverAwareAuthorizer, expireStaleChargeRequests, onSessionStarted, onSessionStopped, startCharge, stopCharge } from "@/server/drivers/charging";
import { deleteMyAccount, exportMyData, getMySession } from "@/server/drivers/service";
import { getPayment, listPayments, processWebhook, reconcile, requestRefund, retryPendingWebhookEvents, applyProviderState } from "@/server/payments/service";
import { sandboxControl, sandboxSettle, signSandbox, SANDBOX_SIGNATURE_HEADER } from "@/server/payments/sandbox";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeAll(() => {
  process.env.PAYMENT_PROVIDER = "sandbox";
  process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET = "segredo-de-teste-sandbox";
  process.env.PAYMENT_PREAUTH_AMOUNT = "100";
});
beforeEach(resetDb);
afterEach(() => Object.assign(sandboxControl, { delayAuthorization: false, failNetwork: false, declineAuthorization: false }));

const iso = (d: Date) => d.toISOString();
let seq = 0;

async function setup(environment: StationEnvironment = "TEST") {
  const op = await bootstrapOperator();
  const admin = await createUser(op.id, "admin");
  const site = await createSite(admin.ctx, { name: "Posto Público", isPublic: true });
  const { station } = await createStation(admin.ctx, { siteId: site.id, ocppIdentity: `CP-${environment}-${++seq}`, environment, heartbeatInterval: 60 });
  await upsertConnector(admin.ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
  await addTariff(admin.ctx, { siteId: site.id, pricePerKwh: 2.4, pricePerMin: 0, validFrom: new Date(Date.now() - 86400000) });
  const hooks = { onStarted: onSessionStarted, onStopped: onSessionStopped };
  const call = async (id: string, action: string, payload: unknown) =>
    handleCall(await db.chargingStation.findUniqueOrThrow({ where: { id: station.id } }), id, action, payload, { authorizer: driverAwareAuthorizer, hooks });
  await call(`st-${seq}`, "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: iso(new Date()) });
  const { token } = await signupDriver({ name: "Ana Motorista", email: `ana${seq}@ex.com`, password: "senha-motorista-123", consent: true });
  const driver = (await resolveDriver(token))!;
  return { op, admin, site, station, call, driver, token };
}

/** Simula o carregador aceitando o RemoteStart: StartTransaction com o idTag do pedido. */
async function chargerStarts(call: (id: string, a: string, p: unknown) => Promise<unknown>, idTag: string, meterStart = 0) {
  return (await call(`start-${++seq}`, "StartTransaction", { connectorId: 1, idTag, meterStart, timestamp: iso(new Date()) })) as { result: { transactionId: number; idTagInfo: { status: string } } };
}

describe("webhooks de pagamento", () => {
  it("confirmação tardia do gateway: só inicia após o webhook; webhook duplicado não reprocessa", async () => {
    const { driver, station } = await setup();
    sandboxControl.delayAuthorization = true;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(req.status).toBe("AWAITING_PAYMENT");
    expect(await db.remoteCommand.count()).toBe(0);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    const hook = await sandboxSettle(payment.providerRef, "AUTHORIZED");
    expect(await processWebhook("sandbox", hook.body, hook.headers)).toMatchObject({ http: 200, outcome: "AUTHORIZED" });
    expect(await processWebhook("sandbox", hook.body, hook.headers)).toMatchObject({ http: 200, outcome: "duplicado (já processado)" });
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("START_REQUESTED");
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
  });

  it("assinatura inválida é recusada sem alterar nada", async () => {
    const { driver, station } = await setup();
    sandboxControl.delayAuthorization = true;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    const body = JSON.stringify({ id: "evt_forjado", type: "charge.authorized", data: { ref: payment.providerRef } });
    expect(await processWebhook("sandbox", body, { [SANDBOX_SIGNATURE_HEADER]: "00".repeat(32) })).toMatchObject({ http: 401 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await db.paymentEvent.count()).toBe(0);
  });

  it("falha de rede ao consultar o provedor: 503, evento pendente; retentativa aplica depois", async () => {
    const { driver, station } = await setup();
    sandboxControl.delayAuthorization = true;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    const hook = await sandboxSettle(payment.providerRef, "AUTHORIZED");
    sandboxControl.failNetwork = true;
    expect(await processWebhook("sandbox", hook.body, hook.headers)).toMatchObject({ http: 503 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    sandboxControl.failNetwork = false;
    expect(await retryPendingWebhookEvents()).toBe(0); // espera mínima de 1 min entre tentativas
    expect(await retryPendingWebhookEvents(new Date(Date.now() + 2 * 60_000))).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("AUTHORIZED");
  });

  it("evento atrasado não regride o status (máquina de estados)", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    const r = await applyProviderState({ ...payment, status: "CAPTURED" }, { providerRef: payment.providerRef, status: "AUTHORIZED", amountAuthorized: "100.00", amountCaptured: "0.00", amountRefunded: "0.00" }, "teste");
    expect(r.applied).toBe(false);
  });

  it("pagamento recusado: pedido falha e nenhum comando é enviado", async () => {
    const { driver, station } = await setup();
    sandboxControl.declineAuthorization = true;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FAILED");
    expect(await db.remoteCommand.count()).toBe(0);
  });
});

describe("ciclo completo de recarga paga (estação de teste + sandbox)", () => {
  it("autoriza, inicia, mede, encerra, apura pela tarifa congelada, captura e concilia", async () => {
    const { driver, station, call, admin, site } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(req.status).toBe("START_REQUESTED");
    const start = await chargerStarts(call, req.idTag, 10_000);
    expect(start.result.idTagInfo.status).toBe("Accepted");
    const session = await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id } });
    expect(session).toMatchObject({ driverId: driver.driverId });
    expect(session.tariffPricePerKwh?.toString()).toBe("2.4");
    // Tarifa muda durante a sessão: não altera o valor desta sessão.
    await addTariff(admin.ctx, { siteId: site.id, pricePerKwh: 9.99, validFrom: new Date() });
    await call("mv", "MeterValues", { connectorId: 1, transactionId: start.result.transactionId, meterValue: [{ timestamp: iso(new Date()), sampledValue: [{ value: "15000" }] }] });
    const live = await getMySession(driver, session.id);
    expect(live.amountKind).toBe("ESTIMATED");
    expect(live.amount).toBe("12.00"); // 5 kWh × 2,40
    await call("stop", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 30_000, timestamp: iso(new Date()) });
    const done = await getMySession(driver, session.id);
    expect(done.amountKind).toBe("COMPUTED");
    expect(done.amount).toBe("48.00"); // 20 kWh × 2,40
    const payment = await db.payment.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(payment.status).toBe("CAPTURED");
    expect(payment.amountCaptured.toString()).toBe("48");
    const rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences).toEqual([]);
    expect(rec.matched).toBe(1);
  });

  it("valor acima da pré-autorização: captura o reservado e a conciliação aponta a divergência", async () => {
    const { driver, station, call, admin } = await setup();
    process.env.PAYMENT_PREAUTH_AMOUNT = "10";
    try {
      const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
      const s = await chargerStarts(call, req.idTag);
      await call("stop", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 20_000, timestamp: iso(new Date()) });
      const p = await db.payment.findFirstOrThrow();
      expect(p.amountCaptured.toString()).toBe("10");
      const rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
      expect(rec.divergences.map((d) => d.kind)).toContain("AMOUNT_MISMATCH");
    } finally {
      process.env.PAYMENT_PREAUTH_AMOUNT = "100";
    }
  });
});

describe("conciliação: pagamento sem sessão e sessão sem pagamento", () => {
  it("pagamento autorizado e carregador nunca iniciou: conciliação acusa; expiração cancela a reserva", async () => {
    const { driver, station, admin } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    await db.payment.update({ where: { id: req.paymentId! }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    // Pedido e início pedidos ao carregador há 20 min (o prazo do carregador conta de startRequestedAt).
    await db.chargeRequest.update({ where: { id: req.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000), startRequestedAt: new Date(Date.now() - 20 * 60_000) } });
    const before = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(before.divergences.map((d) => d.kind)).toContain("PAYMENT_WITHOUT_SESSION");
    expect(await expireStaleChargeRequests()).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } })).status).toBe("CANCELLED");
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FAILED");
  });

  it("falha de rede na captura: sessão fica sem pagamento capturado e a conciliação acusa", async () => {
    const { driver, station, call, admin } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const s = await chargerStarts(call, req.idTag);
    sandboxControl.failNetwork = true;
    await call("stop", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 5000, timestamp: iso(new Date()) });
    sandboxControl.failNetwork = false;
    expect((await db.payment.findFirstOrThrow()).status).toBe("AUTHORIZED");
    const rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences.map((d) => d.kind)).toContain("SESSION_WITHOUT_PAYMENT");
  });

  it("início local sem pedido pago em estação de teste é recusado (evita sessão sem pagamento)", async () => {
    const { driver, call } = await setup();
    const tag = await db.driverIdTag.findFirstOrThrow({ where: { driverId: driver.driverId } });
    expect((await chargerStarts(call, tag.idTag)).result.idTagInfo.status).toBe("Invalid");
  });
});

describe("reembolsos", () => {
  it("exige permissão, respeita o capturado e é confirmado pelo provedor", async () => {
    const { op, driver, station, call, admin } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const s = await chargerStarts(call, req.idTag);
    await call("stop", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) }); // R$ 24,00
    const p = await db.payment.findFirstOrThrow();
    const sales = await createUser(op.id, "commercial");
    await expect(requestRefund(sales.ctx, { paymentId: p.id, amount: 5, reason: "Teste de permissão" })).rejects.toThrow(/permissão/);
    await expect(requestRefund(admin.ctx, { paymentId: p.id, amount: 30, reason: "Acima do capturado" })).rejects.toThrow(/acima do disponível/);
    await requestRefund(admin.ctx, { paymentId: p.id, amount: 4, reason: "Ajuste de tarifa" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PARTIALLY_REFUNDED");
    await requestRefund(admin.ctx, { paymentId: p.id, amount: 20, reason: "Estorno total do restante" });
    const final = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(final.status).toBe("REFUNDED");
    expect(final.amountRefunded.toString()).toBe("24");
    expect(await db.auditEvent.count({ where: { action: "payment.refund_requested" } })).toBe(2);
  });
});

describe("ambientes", () => {
  it("estação de produção: recarga pelo app bloqueada (sem gateway real) e idTag recusado", async () => {
    const { driver, station, call } = await setup("PRODUCTION");
    await expect(startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/indisponível/);
    const tag = await db.driverIdTag.findFirstOrThrow({ where: { driverId: driver.driverId } });
    expect((await chargerStarts(call, tag.idTag)).result.idTagInfo.status).toBe("Invalid");
    expect(await db.payment.count()).toBe(0);
  });

  it("demonstração (simulada): sem pagamento, valor apurado marcado como demonstração", async () => {
    const { driver, station, call, admin } = await setup("SIMULATED");
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(req).toMatchObject({ demo: true, status: "START_REQUESTED", paymentId: null });
    const s = await chargerStarts(call, req.idTag);
    await call("stop", "StopTransaction", { transactionId: s.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    const v = await getMySession(driver, (await db.chargingSession.findFirstOrThrow()).id);
    expect(v.demo).toBe(true);
    expect(v.payment).toBeNull();
    expect(await db.payment.count()).toBe(0);
    expect((await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) })).divergences).toEqual([]);
  });
});

describe("motoristas: autenticação e isolamento", () => {
  it("cadastro valida senha e consentimento; login errado é genérico; logout revoga", async () => {
    await bootstrapOperator();
    await expect(signupDriver({ name: "X Y", email: "x@ex.com", password: "curta", consent: true })).rejects.toThrow();
    await expect(signupDriver({ name: "X Y", email: "x@ex.com", password: "senha-forte-123", consent: false })).rejects.toThrow();
    const { token } = await signupDriver({ name: "X Y", email: "x@ex.com", password: "senha-forte-123", consent: true });
    await expect(signupDriver({ name: "X Y", email: "X@ex.com", password: "senha-forte-123", consent: true })).rejects.toThrow(/Já existe/);
    await expect(loginDriver({ email: "x@ex.com", password: "errada-12345" })).rejects.toThrow("E-mail ou senha inválidos.");
    expect(await resolveSession(token)).toBeNull(); // token de motorista não abre o backoffice
    await logoutDriver(token);
    expect(await resolveDriver(token)).toBeNull();
  });

  it("motorista não vê, não encerra e não cancela recarga de outro", async () => {
    const { driver, station, call } = await setup("SIMULATED");
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const { token } = await signupDriver({ name: "Bruno", email: "bruno@ex.com", password: "senha-bruno-123", consent: true });
    const other = (await resolveDriver(token))!;
    await expect(cancelChargeRequest(other, req.id)).rejects.toThrow(/não encontrado/);
    await chargerStarts(call, req.idTag);
    const session = await db.chargingSession.findFirstOrThrow();
    await expect(getMySession(other, session.id)).rejects.toThrow(/não encontrada/);
    await expect(stopCharge(other, session.id)).rejects.toThrow(/não encontrada/);
    const cmd = await stopCharge(driver, session.id);
    expect(cmd.type).toBe("REMOTE_STOP");
  });
});

describe("assinatura do sandbox", () => {
  it("é HMAC-SHA256 do corpo exato", () => {
    expect(signSandbox("{}")).toMatch(/^[0-9a-f]{64}$/);
    expect(signSandbox("{}")).not.toBe(signSandbox("{ }"));
  });
});

describe("isolamento de pagamentos entre operadoras (P10)", () => {
  it("outra operadora não lista, não abre, não reembolsa nem concilia pagamentos de estações alheias", async () => {
    const { driver, station, call, admin } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const start = await chargerStarts(call, req.idTag);
    await call("stop-iso", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    const payment = await db.payment.findFirstOrThrow({ where: { id: req.paymentId! } });
    expect(payment.status).toBe("CAPTURED");
    expect((await listPayments(admin.ctx)).map((p) => p.id)).toEqual([payment.id]);

    const op2 = await createOrg("Outra Operadora", "OPERATOR");
    const intruder = await createUser(op2.id, "admin");
    expect(await listPayments(intruder.ctx)).toEqual([]);
    await expect(getPayment(intruder.ctx, payment.id)).rejects.toThrow(/não encontrado/);
    await expect(requestRefund(intruder.ctx, { paymentId: payment.id, amount: 1, reason: "tentativa indevida" })).rejects.toThrow(/não encontrado/);
    const rec = await reconcile(intruder.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec).toMatchObject({ checked: 0, sessionsChecked: 0, matched: 0 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded.toString()).toBe("0");
  });
});

describe("LGPD do motorista (P10)", () => {
  it("exporta só os próprios dados; exclusão anonimiza, encerra acesso e preserva registros financeiros", async () => {
    const { driver, station, call, token } = await setup();
    const other = (await resolveDriver((await signupDriver({ name: "Outro Motorista", email: `outro${++seq}@ex.com`, password: "senha-motorista-123", consent: true })).token))!;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const start = await chargerStarts(call, req.idTag);
    await expect(deleteMyAccount(driver, { password: "senha-motorista-123", confirm: true })).rejects.toThrow(/em andamento/);
    await call("stop-lgpd", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });

    const data = await exportMyData(driver);
    expect(data.titular.email).toBe(driver.email);
    expect(data.titular.chargingSessions).toHaveLength(1);
    expect(data.titular.payments).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(other.email);

    await expect(deleteMyAccount(driver, { password: "errada-123456", confirm: true })).rejects.toThrow(/Senha incorreta/);
    await expect(deleteMyAccount(driver, { password: "senha-motorista-123" })).rejects.toThrow();
    await deleteMyAccount(driver, { password: "senha-motorista-123", confirm: true });
    const d = await db.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(d).toMatchObject({ name: "Titular removido", phone: null, email: `removido-${d.id}@anonimizado.invalid` });
    expect(d.disabledAt).not.toBeNull();
    expect(await resolveDriver(token)).toBeNull();
    await expect(loginDriver({ email: driver.email, password: "senha-motorista-123" })).rejects.toThrow(/inválidos/);
    expect(await db.driverIdTag.count({ where: { driverId: d.id, revokedAt: null } })).toBe(0);
    expect(await db.payment.count({ where: { driverId: d.id } })).toBe(1); // retido sem identificação direta
    expect(await resolveDriver((await loginDriver({ email: other.email, password: "senha-motorista-123" })).token)).not.toBeNull();
  });
});
