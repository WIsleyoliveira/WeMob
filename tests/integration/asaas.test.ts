/**
 * Integração Asaas (fluxo pré-pago Pix) contra um servidor Asaas FALSO em memória (tests/support/fake-asaas.ts).
 * Provam a lógica da WeMob (estados, idempotência, segurança, split, conciliação); NÃO provam compatibilidade
 * com a API real — isso exige o sandbox oficial (npm run asaas:homologar, pendente de credenciais).
 * Os números [n] referem-se aos 30 cenários obrigatórios do P13.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { db } from "@/server/db";
import { handleCall } from "@/server/ocpp/handler";
import { createSite, createStation, upsertConnector, addTariff } from "@/server/modules/stations/service";
import { signupDriver, resolveDriver } from "@/server/drivers/auth";
import { getDriverStation, listDriverStations, setMyDocument, syncPendingPayment } from "@/server/drivers/service";
import { cancelChargeRequest, checkSessionLimit, driverAwareAuthorizer, enforceSessionLimits, expireStaleChargeRequests, onSessionStarted, onSessionStopped, startCharge } from "@/server/drivers/charging";
import { evaluateAlerts } from "@/server/modules/alerts/engine";
import { runOperationsCycle } from "@/server/modules/automation/runner";
import { ensureDefaultAlertRules } from "@/server/modules/alerts/rules";
import { getPayment, listPayments, processWebhook, reconcile, requestRefund, resolveReview, retryDueRefunds, retryPendingWebhookEvents, retryRefundNow } from "@/server/payments/service";
import { createChargePayment, refreshFromProvider } from "@/server/payments/charges";
import { __setAsaasFetchForTests } from "@/server/payments/asaas/provider";
import { readAsaasConfig } from "@/server/payments/asaas/config";
import { activeProvider } from "@/server/payments/registry";
import { productionReadiness } from "@/server/payments/activation";
import { createRecipient, createSplitPolicy, decideSplitPolicy, listSplitConfig, validateRecipient } from "@/server/payments/split";
import { approveClosing, computeClosing, requestClosing } from "@/server/modules/finance/closing";
import { createContract, decideContractVersion } from "@/server/modules/contracts/service";
import { createTaxRule } from "@/server/modules/finance/entries";
import { createFakeAsaas } from "../support/fake-asaas";
import { partnerSplits } from "@/server/modules/partner/portal";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

const KEY = "chave-falsa-de-sandbox-para-testes";
const TOKEN = "token-webhook-de-teste-com-mais-de-32-caracteres";
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const ENV_KEYS = ["PAYMENT_PROVIDER", "ASAAS_ENVIRONMENT", "ASAAS_SANDBOX_API_KEY", "ASAAS_PRODUCTION_API_KEY", "ASAAS_WEBHOOK_TOKEN", "ASAAS_SPLIT_ENABLED", "ASAAS_PRODUCTION_ENABLED", "DATA_ENCRYPTION_KEY", "PAYMENT_PREAUTH_AMOUNT", "ASAAS_OWN_WALLET_ID"] as const;
const saved: Record<string, string | undefined> = {};

let fake: ReturnType<typeof createFakeAsaas>;
let seq = 0;
const iso = (d: Date) => d.toISOString();

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { PAYMENT_PROVIDER: "asaas", ASAAS_ENVIRONMENT: "sandbox", ASAAS_SANDBOX_API_KEY: KEY, ASAAS_WEBHOOK_TOKEN: TOKEN, DATA_ENCRYPTION_KEY: "a".repeat(64), PAYMENT_PREAUTH_AMOUNT: "50" });
  delete process.env.ASAAS_PRODUCTION_API_KEY;
  delete process.env.ASAAS_SPLIT_ENABLED;
});
afterAll(() => {
  for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  __setAsaasFetchForTests(null);
});
beforeEach(async () => {
  await resetDb();
  delete process.env.ASAAS_SPLIT_ENABLED;
  fake = createFakeAsaas({ apiKey: KEY, knownWallets: [W1, W2] });
  __setAsaasFetchForTests(fake.fetch);
});

async function setup() {
  const op = await bootstrapOperator();
  const admin = await createUser(op.id, "admin");
  const admin2 = await createUser(op.id, "admin");
  const fin = await createUser(op.id, "finance");
  const support = await createUser(op.id, "support");
  const partnerOrg = await createOrg("Posto Parceiro", "PARTNER");
  const site = await createSite(admin.ctx, { name: "Posto Pix", isPublic: true, partnerOrganizationId: partnerOrg.id });
  const { station } = await createStation(admin.ctx, { siteId: site.id, ocppIdentity: `CP-PIX-${++seq}`, environment: "TEST", heartbeatInterval: 60 });
  await upsertConnector(admin.ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
  await addTariff(admin.ctx, { siteId: site.id, pricePerKwh: 2, pricePerMin: 0, validFrom: new Date(Date.now() - 86400000) });
  const hooks = { onStarted: onSessionStarted, onStopped: onSessionStopped };
  const call = async (id: string, action: string, payload: unknown) =>
    handleCall(await db.chargingStation.findUniqueOrThrow({ where: { id: station.id } }), id, action, payload, { authorizer: driverAwareAuthorizer, hooks });
  await call(`st-${seq}`, "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: iso(new Date()) });
  const { token } = await signupDriver({ name: "Bia Motorista", email: `bia${seq}@ex.com`, password: "senha-motorista-123", consent: true });
  const driver = (await resolveDriver(token))!;
  await setMyDocument(driver, { document: "529.982.247-25" });
  return { op, admin, admin2, fin, support, partnerOrg, site, station, call, driver };
}

const hook = (event: string, paymentId: string, eventId?: string) => fake.webhook(event, paymentId, TOKEN, eventId);
const remoteOf = async (paymentId: string) => fake.payments.get((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).providerRef)!;

describe("cobrança Pix", () => {
  it("[1] cria Pix com QR/copia e cola; nada inicia antes da confirmação do gateway", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(req.status).toBe("AWAITING_PAYMENT");
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    expect(p).toMatchObject({ method: "PIX", status: "PENDING", provider: "asaas", environment: "SANDBOX", externalReference: `charge:${req.id}` });
    expect(p.pixPayload).toMatch(/^000201/);
    expect(p.amountAuthorized.toString()).toBe("50");
    expect(await db.remoteCommand.count()).toBe(0);
    const r = await remoteOf(p.id);
    expect(r).toMatchObject({ billingType: "PIX", value: 50, externalReference: `charge:${req.id}` });
    expect(fake.customers.size).toBe(1);
    expect(fake.control.requests.every((x) => x.userAgent)).toBe(true);
    expect(JSON.stringify(await db.paymentOperation.findMany())).not.toContain("529");
  });

  it("[3] troca de CPF não reaproveita o cliente remoto cadastrado com o documento antigo", async () => {
    const { driver, station } = await setup();
    const r1 = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    await cancelChargeRequest(driver, r1.id);
    await setMyDocument(driver, { document: "168.995.350-09" });
    await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(fake.customers.size).toBe(2);
    expect([...fake.customers.values()].map((c) => c.cpfCnpj).sort()).toEqual(["16899535009", "52998224725"]);
    const last = await db.payment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(fake.customers.get((await remoteOf(last.id)).customer)?.cpfCnpj).toBe("16899535009");
  });

  it("[2] cobrança recusada pelo provedor: pedido falha com o motivo e nenhum comando", async () => {
    const { driver, station } = await setup();
    fake.control.rejectNextPayment = "A conta não está apta a receber Pix.";
    await expect(startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/recusada pelo Asaas: A conta não está apta/);
    expect((await db.chargeRequest.findFirstOrThrow()).status).toBe("FAILED");
    expect(await db.remoteCommand.count()).toBe(0);
  });

  it("[3] falhas de validação: CPF inválido e motorista sem CPF", async () => {
    const { station } = await setup();
    const { token } = await signupDriver({ name: "Sem Doc", email: `semdoc${++seq}@ex.com`, password: "senha-motorista-123", consent: true });
    const d2 = (await resolveDriver(token))!;
    await expect(setMyDocument(d2, { document: "111.111.111-11" })).rejects.toThrow(/inválido/);
    await expect(startCharge(d2, { identity: station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/Informe seu CPF/);
    const stored = await db.driver.findUniqueOrThrow({ where: { id: d2.driverId } });
    expect(stored.documentEnc).toBeNull();
  });

  it("[4][5] timeout após o envio: a cobrança é localizada pela chave; retry idempotente não duplica", async () => {
    const { driver, station, op, site } = await setup();
    fake.control.timeoutAfterProcessingNextPayment = true;
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(req.status).toBe("AWAITING_PAYMENT");
    expect(fake.payments.size).toBe(1);
    const again = await createChargePayment({ provider: activeProvider(), operatorId: op.id, siteId: site.id, stationEnvironment: "TEST", driverId: driver.driverId, chargeRequestId: req.id, amount: "50", description: "x" });
    expect(again.id).toBe(req.paymentId);
    expect(fake.payments.size).toBe(1);
    expect(await db.paymentOperation.count()).toBe(1);
  });

  it("[4][26] timeout sem efeito + gateway inacessível: operação fica DESCONHECIDA, sem nova cobrança; conciliação aponta", async () => {
    const { driver, station, admin } = await setup();
    fake.control.timeoutBeforeProcessingNextPayment = true;
    await expect(startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/não confirmou a criação/);
    expect(fake.payments.size).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect((await db.paymentOperation.findFirstOrThrow()).status).toBe("UNKNOWN");
    const rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences.map((d) => d.kind)).toContain("OPERATION_UNKNOWN");
  });
});

describe("webhooks Asaas", () => {
  async function paidFlow() {
    const s = await setup();
    const req = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    return { ...s, req, payment };
  }

  it("[6][7] PAYMENT_RECEIVED confirmado pela consulta → recarga autorizada; reentrega não reprocessa", async () => {
    const { req, payment } = await paidFlow();
    fake.pay(payment.providerRef);
    const h = hook("PAYMENT_RECEIVED", payment.providerRef, "evt_dup_1");
    expect(await processWebhook("asaas", h.body, h.headers)).toMatchObject({ http: 200, outcome: "CAPTURED" });
    expect(await processWebhook("asaas", h.body, h.headers)).toMatchObject({ http: 200, outcome: "duplicado (já processado)" });
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("START_REQUESTED");
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
    const ev = await db.paymentEvent.findFirstOrThrow();
    expect(JSON.stringify(ev.payload)).not.toContain("cus_pii"); // payload mínimo, sem dados do pagador
  });

  it("[8] token inválido: 401 sem registrar nem alterar", async () => {
    const { payment } = await paidFlow();
    fake.pay(payment.providerRef);
    const h = hook("PAYMENT_RECEIVED", payment.providerRef);
    expect(await processWebhook("asaas", h.body, { "asaas-access-token": "x".repeat(TOKEN.length) })).toMatchObject({ http: 401 });
    expect(await processWebhook("asaas", h.body, {})).toMatchObject({ http: 401 });
    expect(await db.paymentEvent.count()).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("[9] evento antigo fora de ordem não regride o estado (vale a consulta ao gateway)", async () => {
    const { payment } = await paidFlow();
    fake.pay(payment.providerRef);
    const r = hook("PAYMENT_RECEIVED", payment.providerRef);
    await processWebhook("asaas", r.body, r.headers);
    const late = hook("PAYMENT_CREATED", payment.providerRef);
    await processWebhook("asaas", late.body, late.headers);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CAPTURED");
  });

  it("[10] pago no gateway sem webhook: conciliação acusa; atualização pela consulta autenticada corrige", async () => {
    const { payment, admin } = await paidFlow();
    fake.pay(payment.providerRef);
    const rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences.some((d) => d.kind === "PROVIDER_MISMATCH" && d.paymentId === payment.id)).toBe(true);
    const after = await refreshFromProvider(payment.id, activeProvider());
    expect(after.status).toBe("CAPTURED");
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
  });

  it("página do pedido confirma o Pix sozinha (sem webhook), no máximo 1 consulta a cada 10 s, só do próprio pedido", async () => {
    const { payment, driver, req } = await paidFlow();
    const consultas = () => fake.control.requests.filter((x) => x.method === "GET" && x.path === `/payments/${payment.providerRef}`).length;
    const antes = consultas();
    vi.useFakeTimers({ toFake: ["Date"] }); // relógio parado no início de uma janela de 10 s do limitador
    vi.setSystemTime(new Date(Math.floor(Date.now() / 10_000) * 10_000 + 20_000));
    try {
    await syncPendingPayment(driver, req.id);
    expect(consultas()).toBe(antes + 1);
    fake.pay(payment.providerRef);
    await syncPendingPayment(driver, req.id); // dentro da janela de 10 s: não consulta de novo
    expect(consultas()).toBe(antes + 1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    vi.setSystemTime(new Date(Date.now() + 10_000)); // próxima janela
    const { token } = await signupDriver({ name: "Outro", email: `outro${seq}@ex.com`, password: "senha-motorista-123", consent: true });
    await syncPendingPayment((await resolveDriver(token))!, req.id); // pedido de outro motorista: ignorado
    expect(consultas()).toBe(antes + 1);
    await syncPendingPayment(driver, req.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CAPTURED");
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("[26][28] falha de comunicação ao consultar: 200 (fila do Asaas não pausa), evento pendente; retentativa aplica", async () => {
    const { payment } = await paidFlow();
    fake.pay(payment.providerRef);
    fake.control.failGetPayment = true;
    const h = hook("PAYMENT_RECEIVED", payment.providerRef);
    expect(await processWebhook("asaas", h.body, h.headers)).toMatchObject({ http: 200, outcome: "registrado; processamento pendente" });
    expect((await db.paymentEvent.findFirstOrThrow()).processedAt).toBeNull();
    fake.control.failGetPayment = false;
    expect(await retryPendingWebhookEvents()).toBe(0); // espera de 1 min antes da retentativa
    expect(await retryPendingWebhookEvents(new Date(Date.now() + 2 * 60_000))).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CAPTURED");
    expect(await retryPendingWebhookEvents(new Date(Date.now() + 3 * 60_000))).toBe(0);
  });

  it("P16: retentativa com espera crescente (1, 2, 4… até 60 min) e sem fila presa por eventos antigos de cobranças desconhecidas", async () => {
    const { payment } = await paidFlow();
    // 120 eventos antigos de cobranças desconhecidas (como os das cobranças do script de homologação)
    await db.paymentEvent.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ provider: "asaas", eventId: `old-${i}`, type: "PAYMENT_CREATED", signatureValid: true, payload: { payment: { id: `pay_desconhecida_${i}` } }, receivedAt: new Date(Date.now() - 3600_000) })) });
    fake.pay(payment.providerRef);
    fake.control.failGetPayment = true;
    const h = hook("PAYMENT_RECEIVED", payment.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    const t0 = Date.now();
    await retryPendingWebhookEvents(new Date(t0 + 2 * 60_000)); // desconhecidos: adiados 15 min; o real falha de novo
    const ev = await db.paymentEvent.findFirstOrThrow({ where: { type: "PAYMENT_RECEIVED" } });
    expect(ev.attempts).toBe(2);
    expect(ev.nextAttemptAt!.getTime() - (t0 + 2 * 60_000)).toBe(2 * 60_000);
    fake.control.failGetPayment = false;
    expect(await retryPendingWebhookEvents(new Date(t0 + 5 * 60_000))).toBe(1); // não ficou atrás dos 120 antigos
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CAPTURED");
    const { webhookRetryAt } = await import("@/server/payments/service");
    expect(webhookRetryAt(new Date(0), 30).getTime()).toBe(60 * 60_000);
  });

  it("[27] eventos concorrentes (CONFIRMED e RECEIVED): um único comando de início", async () => {
    const { payment } = await paidFlow();
    fake.pay(payment.providerRef);
    const a = hook("PAYMENT_CONFIRMED", payment.providerRef);
    const b = hook("PAYMENT_RECEIVED", payment.providerRef);
    await Promise.all([processWebhook("asaas", a.body, a.headers), processWebhook("asaas", b.body, b.headers)]);
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
  });
});

describe("sessão, expiração, cancelamento e acerto", () => {
  it("[11] Pix não pago na janela: cobrança removida no gateway e pedido EXPIRADO", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect(await expireStaleChargeRequests(new Date(Date.now() + 5 * 60_000))).toBe(0); // ainda dentro da janela de 15 min
    await expireStaleChargeRequests(new Date(Date.now() + 16 * 60_000));
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("EXPIRED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } })).status).toBe("CANCELLED");
    expect((await remoteOf(req.paymentId!)).deleted).toBe(true);
  });

  it("[12] cancelado pelo motorista antes do pagamento: removido no gateway; pago no meio do caminho vai para análise", async () => {
    const { driver, station } = await setup();
    const r1 = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    await cancelChargeRequest(driver, r1.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: r1.paymentId! } })).status).toBe("CANCELLED");
    const r2 = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    fake.pay((await db.payment.findUniqueOrThrow({ where: { id: r2.paymentId! } })).providerRef); // pagou sem a WeMob saber ainda
    await cancelChargeRequest(driver, r2.id);
    const p2 = await db.payment.findUniqueOrThrow({ where: { id: r2.paymentId! } });
    expect(p2.status).toBe("CAPTURED");
    expect(p2.reviewReason).toMatch(/cancelado pelo motorista/);
    expect(await db.refund.count()).toBe(0); // sem estorno automático
    expect(await db.remoteCommand.count()).toBe(0);
  });

  it("[13] carregador não inicia após o pagamento: pedido falha e pagamento vai para análise (sem estorno automático)", async () => {
    const { driver, station, admin } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    const h = hook("PAYMENT_RECEIVED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    await expireStaleChargeRequests(new Date(Date.now() + 4 * 60_000));
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FAILED");
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.reviewReason).toMatch(/não iniciou/);
    expect(await db.refund.count()).toBe(0);
    await expect(resolveReview(admin.ctx, { paymentId: p.id, note: "curto" })).rejects.toThrow();
    await resolveReview(admin.ctx, { paymentId: p.id, note: "Estorno integral solicitado ao motorista via suporte." });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reviewResolvedAt).not.toBeNull();
  });

  it("ciclo completo: pago → inicia → 10 kWh × R$ 2 → estorna a diferença (R$ 30) uma única vez", async () => {
    const { driver, station, call } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    const h = hook("PAYMENT_RECEIVED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    const start = (await call("start-1", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number; idTagInfo: { status: string } } };
    expect(start.result.idTagInfo.status).toBe("Accepted");
    await call("stop-1", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    await call("stop-1b", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) }); // repetido
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { refunds: true, session: true } });
    expect(after.session?.amount?.toString()).toBe("20");
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({ status: "SUCCEEDED", remoteStatus: "DONE", requestedById: "system:settlement" });
    expect(after.refunds[0].amount.toString()).toBe("30");
    expect(after).toMatchObject({ status: "PARTIALLY_REFUNDED" });
    expect(after.amountRefunded.toString()).toBe("30");
    expect(after.feeAmount?.toString()).toBe("0.99");
    expect((await remoteOf(p.id)).refunds).toHaveLength(1);
  });
});

describe("cartão (página de pagamento do Asaas)", () => {
  it("cria cobrança CREDIT_CARD sem QR Code, guarda a página de pagamento e nunca envia dados de cartão", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    expect(p).toMatchObject({ method: "CARD", status: "PENDING", pixPayload: null, externalReference: `charge:${req.id}` });
    expect(p.invoiceUrl).toMatch(/^https:\/\/sandbox\.asaas\.com\//);
    const r = await remoteOf(p.id);
    expect(r).toMatchObject({ billingType: "CREDIT_CARD", value: 50 });
    expect(r).not.toHaveProperty("creditCard");
    expect(fake.control.requests.some((x) => x.path.endsWith("/pixQrCode"))).toBe(false);
    expect(await db.remoteCommand.count()).toBe(0);
  });

  it("estação de TESTE abre pelo link/QR direto (homologação), mas não aparece na lista da rede", async () => {
    const { station } = await setup();
    expect((await getDriverStation(station.ocppIdentity)).environment).toBe("TEST");
    expect((await listDriverStations("real")).some((x) => x.identity === station.ocppIdentity)).toBe(false);
  });

  it("forma de pagamento inválida é recusada; sem escolha, o padrão é Pix", async () => {
    const { driver, station } = await setup();
    await expect(startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "BOLETO" })).rejects.toThrow();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } })).method).toBe("PIX");
  });

  it("ciclo completo no cartão: aprovado → inicia → 10 kWh × R$ 2 → estorna R$ 30 uma única vez", async () => {
    const { driver, station, call } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef, "CONFIRMED"); // cartão aprovado
    const h = hook("PAYMENT_CONFIRMED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    expect(await db.remoteCommand.count({ where: { type: "REMOTE_START" } })).toBe(1);
    const start = (await call("card-start", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number; idTagInfo: { status: string } } };
    expect(start.result.idTagInfo.status).toBe("Accepted");
    await call("card-stop", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { refunds: true, session: true } });
    expect(after.session?.amount?.toString()).toBe("20");
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0].amount.toString()).toBe("30");
    expect(after).toMatchObject({ status: "PARTIALLY_REFUNDED", method: "CARD" });
  });

  it("cartão não pago no prazo: cobrança removida no gateway e pedido EXPIRADO", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" });
    await expireStaleChargeRequests(new Date(Date.now() + 60 * 60_000));
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("EXPIRED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } })).status).toBe("CANCELLED");
  });
});

describe("ciclo de cobrança: duplicidade e autorização (P15)", () => {
  it("dois pedidos simultâneos do mesmo motorista: um único pedido aberto e uma única cobrança no gateway", async () => {
    const { driver, station } = await setup();
    const results = await Promise.allSettled([
      startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 }),
      startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.chargeRequest.count({ where: { driverId: driver.driverId, status: { in: ["AWAITING_PAYMENT", "START_REQUESTED"] } } })).toBe(1);
    expect(fake.payments.size).toBe(1);
  });

  it("dois motoristas no mesmo conector: o segundo é recusado antes de qualquer cobrança", async () => {
    const { driver, station } = await setup();
    await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const { token } = await signupDriver({ name: "Caio", email: `caio${seq}@ex.com`, password: "senha-motorista-123", consent: true });
    const other = (await resolveDriver(token))!;
    await setMyDocument(other, { document: "390.533.447-05" });
    await expect(startCharge(other, { identity: station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/andamento/);
    expect(fake.payments.size).toBe(1);
  });

  it("pago 20 min após o pedido (achado no sandbox): não expira, a sessão é vinculada e a diferença é estornada", async () => {
    const { driver, station, call } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" });
    await db.chargeRequest.update({ where: { id: req.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } }); // motorista demorou a pagar
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef, "CONFIRMED");
    const h = hook("PAYMENT_CONFIRMED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("START_REQUESTED");
    await expireStaleChargeRequests(); // ciclo de 1 min do servidor OCPP: o prazo do carregador conta do pedido de início
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("START_REQUESTED");
    const start = (await call("late-start", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number } };
    await call("late-stop", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { refunds: true } });
    expect(after.sessionId).not.toBeNull();
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0].amount.toString()).toBe("30");
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("STARTED");
  });

  it("carregador não inicia em 3 min após o pagamento: pedido falha e o pagamento vai para análise", async () => {
    const { driver, station } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    await refreshFromProvider(p.id, activeProvider());
    await expireStaleChargeRequests(new Date(Date.now() + 4 * 60_000));
    expect((await db.chargeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FAILED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reviewOpenedAt).not.toBeNull();
  });

  it("etiqueta de bancada (TEST-/SIM-) não inicia recarga em estação de PRODUÇÃO", async () => {
    const { station } = await setup();
    expect(await driverAwareAuthorizer.authorize("TEST-0001", { ...station, environment: "PRODUCTION" })).toBe("Invalid");
    expect(await driverAwareAuthorizer.authorize("SIM-0001", { ...station, environment: "PRODUCTION" })).toBe("Invalid");
    expect(await driverAwareAuthorizer.authorize("TEST-0001", station)).toBe("Accepted"); // TEST: bancada continua valendo
  });
});

describe("conciliação automática (P16)", () => {
  it("roda no ciclo de automações no máximo 1×/h, só aponta (sem alterar status nem estornar) e registra o resumo", async () => {
    const { driver, station, op } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef); // pago no gateway sem webhook
    const t = new Date(Date.now() + 20 * 60_000);
    await runOperationsCycle(t);
    const runs = await db.automationRun.findMany({ where: { job: "payments.reconcile", operatorId: op.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");
    expect((runs[0].stats as { byKind: Record<string, number> }).byKind.PROVIDER_MISMATCH).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING"); // não muda status sozinha
    expect(await db.refund.count()).toBe(0); // nenhum ajuste financeiro automático
    await runOperationsCycle(new Date(t.getTime() + 10 * 60_000));
    expect(await db.automationRun.count({ where: { job: "payments.reconcile", operatorId: op.id } })).toBe(1);
    await runOperationsCycle(new Date(t.getTime() + 61 * 60_000));
    expect(await db.automationRun.count({ where: { job: "payments.reconcile", operatorId: op.id } })).toBe(2);
  });
});

describe("limite financeiro da sessão (P16)", () => {
  // Pix de R$ 50, tarifa R$ 2/kWh, margem padrão 10% → limite R$ 45 (22,5 kWh); aviso a 90% (R$ 40,50).
  async function charging() {
    const s = await setup();
    const req = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    const h = hook("PAYMENT_RECEIVED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    const hooks = { onStarted: onSessionStarted, onStopped: onSessionStopped, onMeter: async (id: string) => void (await checkSessionLimit(id)) };
    const call = async (id: string, action: string, payload: unknown) =>
      handleCall(await db.chargingStation.findUniqueOrThrow({ where: { id: s.station.id } }), id, action, payload, { authorizer: driverAwareAuthorizer, hooks });
    const start = (await call("lim-start", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number } };
    const tx = start.result.transactionId;
    const meter = (id: string, wh: number) => call(id, "MeterValues", { connectorId: 1, transactionId: tx, meterValue: [{ timestamp: iso(new Date()), sampledValue: [{ value: String(wh) }] }] });
    const session = () => db.chargingSession.findFirstOrThrow({ where: { stationId: s.station.id, transactionId: tx } });
    return { ...s, req, payment: p, call, tx, meter, session };
  }
  const stops = () => db.remoteCommand.count({ where: { type: "REMOTE_STOP" } });

  it("cobertura e limite gravados no início; aviso a 90%; no limite UMA parada remota, mesmo com leituras e varreduras repetidas", async () => {
    const { meter, session, call, tx, payment } = await charging();
    expect((await session()).fundedAmount?.toString()).toBe("50");
    expect((await session()).limitAmount?.toString()).toBe("45");
    await meter("m1", 20_000); // R$ 40 → abaixo do aviso
    expect((await session()).limitWarnedAt).toBeNull();
    await meter("m2", 21_000); // R$ 42 → aviso
    expect((await session()).limitWarnedAt).not.toBeNull();
    expect(await stops()).toBe(0);
    await meter("m3", 22_600); // R$ 45,20 → limite
    expect(await stops()).toBe(1);
    await meter("m4", 22_700);
    await Promise.all([enforceSessionLimits(), enforceSessionLimits()]);
    expect(await stops()).toBe(1);
    const s1 = await session();
    expect(s1.limitStopRequestedAt).not.toBeNull();
    expect((await db.remoteCommand.findUniqueOrThrow({ where: { id: s1.limitStopCommandId! } })).payload).toEqual({ transactionId: tx });
    // O carregador encerra pouco depois do limite: valor dentro da cobertura, diferença estornada.
    await call("lim-stop", "StopTransaction", { transactionId: tx, meterStop: 22_900, timestamp: iso(new Date()) });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } });
    expect((await session()).amount?.toString()).toBe("45.8");
    expect(after.refunds[0].amount.toString()).toBe("4.2");
    expect(after.reviewOpenedAt).toBeNull();
  });

  it("sem leituras do medidor: a varredura periódica aplica o limite pelo tempo (tarifa por minuto)", async () => {
    const { session, site, admin } = await charging();
    await db.chargingSession.update({ where: { id: (await session()).id }, data: { tariffPricePerKwh: 0, tariffPricePerMin: 1 } }); // R$ 1/min
    void site; void admin;
    expect((await enforceSessionLimits(new Date(Date.now() + 30 * 60_000))).stops).toBe(0); // R$ 30
    expect((await enforceSessionLimits(new Date(Date.now() + 46 * 60_000))).stops).toBe(1); // R$ 46 ≥ 45
    expect(await stops()).toBe(1);
  });

  it("parada não confirmada (carregador ignora/offline): alerta de contingência; excedente vai para análise sem cobrança complementar", async () => {
    const { meter, session, call, tx, payment, op } = await charging();
    await ensureDefaultAlertRules(db, op.id);
    await db.alertRule.updateMany({ where: { operatorId: op.id, kind: "PAYMENT_DIVERGENCE" }, data: { includeNonProduction: true } });
    await meter("x1", 23_000);
    expect(await stops()).toBe(1);
    await db.remoteCommand.updateMany({ where: { type: "REMOTE_STOP" }, data: { status: "TIMEOUT", completedAt: new Date() } }); // carregador não respondeu
    expect((await enforceSessionLimits(new Date(Date.now() + 2 * 60_000))).retried).toBe(1); // nova parada
    expect(await stops()).toBe(2);
    expect((await enforceSessionLimits(new Date(Date.now() + 2 * 60_000))).retried).toBe(0); // já há uma pendente
    for (let i = 0; i < 5; i++) {
      await db.remoteCommand.updateMany({ where: { type: "REMOTE_STOP", status: "PENDING" }, data: { status: "TIMEOUT", completedAt: new Date() } });
      await enforceSessionLimits(new Date(Date.now() + (3 + i) * 60_000));
    }
    expect(await stops()).toBe(5); // limite de tentativas
    await evaluateAlerts(op.id, new Date(Date.now() + 4 * 60_000));
    const alert = await db.alert.findFirstOrThrow({ where: { dedupeKey: `session-limit-stop:${(await session()).id}` } });
    expect(alert.title).toMatch(/parada NÃO confirmada/);
    expect(alert.detail).toMatch(/TIMEOUT/);
    // Encerrado depois, acima da cobertura: R$ 56 consumidos × R$ 50 pagos.
    await call("x-stop", "StopTransaction", { transactionId: tx, meterStop: 28_000, timestamp: iso(new Date()) });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } });
    expect(after.refunds).toHaveLength(0);
    expect(after.reviewReason).toMatch(/Consumo acima do valor pré-pago: R\$ 6\.00/);
    expect(fake.control.requests.filter((x) => x.method === "POST" && x.path === "/payments")).toHaveLength(1); // nenhuma cobrança complementar
    await evaluateAlerts(op.id, new Date(Date.now() + 5 * 60_000));
    expect((await db.alert.findFirstOrThrow({ where: { dedupeKey: `session-limit-stop:${(await session()).id}` } })).status).toBe("RESOLVED");
  });

  it("margem configurável dentro de 2–30%; sessão sem cobertura (bancada) não tem limite", async () => {
    const { limitMargin, sessionLimit } = await import("@/domain/charging/limit");
    expect(limitMargin(undefined)).toBe(0.1);
    expect(limitMargin("0.5")).toBe(0.3);
    expect(limitMargin("0")).toBe(0.02);
    expect(limitMargin("abc")).toBe(0.1);
    expect(sessionLimit("49.99", 0.1).toString()).toBe("44.99");
    const { station, call } = await setup();
    await call("b1", "StartTransaction", { connectorId: 1, idTag: "TEST-BANCADA", meterStart: 0, timestamp: iso(new Date()) });
    const b = await db.chargingSession.findFirstOrThrow({ where: { stationId: station.id, idTag: "TEST-BANCADA" } });
    expect(b.limitAmount).toBeNull();
  });
});

describe("estornos", () => {
  async function captured() {
    const s = await setup();
    const req = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    const h = hook("PAYMENT_RECEIVED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    return { ...s, payment: p };
  }

  const NEXT_DAY = "Esta transação só pode ser estornada parcialmente no próximo dia."; // texto real do sandbox (P15)

  it("P16: cartão recusa estorno parcial no mesmo dia → AGENDADO (nada devolvido); retentativa no dia seguinte conclui uma vez", async () => {
    const { payment, fin } = await captured();
    fake.control.rejectRefund = NEXT_DAY;
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "10", reason: "diferença" });
    expect(r).toMatchObject({ status: "SCHEDULED", remoteStatus: "RETRY_LATER", attempts: 1, lastError: NEXT_DAY });
    expect(r.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    let p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("CAPTURED");
    expect(p.amountRefunded.toString()).toBe("0");
    // Agendado conta como em andamento: não permite estornar além do pago.
    await expect(requestRefund(fin.ctx, { paymentId: payment.id, amount: "45", reason: "segundo estorno" })).rejects.toThrow(/disponível/);
    expect(await retryDueRefunds(new Date())).toEqual([]); // ainda não venceu
    fake.control.rejectRefund = null;
    const res = await retryDueRefunds(new Date(r.nextAttemptAt!.getTime() + 1000));
    expect(res).toEqual([{ refundId: r.id, status: "SUCCEEDED" }]);
    const done = await db.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(done).toMatchObject({ status: "SUCCEEDED", remoteStatus: "DONE", attempts: 2, nextAttemptAt: null });
    expect(done.confirmedAmount?.toString()).toBe("10");
    p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.amountRefunded.toString()).toBe("10");
    expect((await remoteOf(payment.id)).refunds).toHaveLength(1);
    expect(await retryDueRefunds(new Date(Date.now() + 86400_000 * 3))).toEqual([]); // nada a repetir
  });

  it("P16: timeout APÓS o gateway estornar → resultado incerto; a verificação encontra o estorno pelo marcador e NÃO reenvia", async () => {
    const { payment, fin } = await captured();
    fake.control.timeoutAfterProcessingNextRefund = true;
    fake.control.failGetPayment = true; // a consulta imediata também falha
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "12.5", reason: "diferença" });
    expect(r).toMatchObject({ status: "REQUESTED", remoteStatus: "UNKNOWN" });
    fake.control.failGetPayment = false;
    const res = await retryDueRefunds(new Date(r.nextAttemptAt!.getTime() + 1000));
    expect(res).toEqual([{ refundId: r.id, status: "SUCCEEDED" }]);
    expect((await remoteOf(payment.id)).refunds).toHaveLength(1); // um único estorno no gateway
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).attempts).toBe(1);
  });

  it("P16: gateway indisponível ANTES de processar → incerto; verificação não encontra o estorno e reenvia uma vez", async () => {
    const { payment, fin } = await captured();
    fake.control.unavailableBeforeNextRefund = true;
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "5", reason: "diferença" });
    expect(r).toMatchObject({ status: "REQUESTED", remoteStatus: "UNKNOWN" });
    expect((await remoteOf(payment.id)).refunds).toHaveLength(0);
    await retryDueRefunds(new Date(r.nextAttemptAt!.getTime() + 1000));
    expect(await db.refund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect((await remoteOf(payment.id)).refunds).toHaveLength(1);
  });

  it("P16: recusa permanente nas retentativas → FALHO após o limite, pagamento em análise; retentativa concorrente não duplica", async () => {
    const { payment, fin, admin } = await captured();
    fake.control.rejectRefund = NEXT_DAY;
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "10", reason: "diferença" });
    let t = r.nextAttemptAt!.getTime();
    for (let i = 0; i < 6; i++) {
      // duas execuções simultâneas do ciclo: o lease garante um único envio por vez
      await Promise.all([retryDueRefunds(new Date(t + 1000)), retryDueRefunds(new Date(t + 1000))]);
      const cur = await db.refund.findUniqueOrThrow({ where: { id: r.id } });
      if (cur.status === "FAILED") break;
      t = cur.nextAttemptAt!.getTime();
    }
    const end = await db.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(end.status).toBe("FAILED");
    expect(end.attempts).toBe(5);
    expect(fake.control.requests.filter((x) => x.method === "POST" && x.path.endsWith("/refund"))).toHaveLength(5);
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.reviewOpenedAt).not.toBeNull();
    expect(p.amountRefunded.toString()).toBe("0");
    // "Tentar agora" só para estorno aguardando; sem permissão é negado
    await expect(retryRefundNow(fin.ctx, { refundId: r.id })).rejects.toThrow(/aguardando/);
    void admin;
  });

  it("P17: 'Tentar agora' durante a retentativa automática não envia o estorno duas vezes", async () => {
    const { payment, fin } = await captured();
    fake.control.rejectRefund = NEXT_DAY;
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "10", reason: "diferença" });
    fake.control.rejectRefund = null;
    fake.control.getDelayMs = 300; // a consulta ao gateway antes de reenviar demora
    fake.control.refundDelayMs = 500; // e o envio do estorno também
    const due = new Date(r.nextAttemptAt!.getTime() + 1000);
    const auto = retryDueRefunds(due); // ciclo automático pega o estorno e consulta o gateway
    await new Promise((x) => setTimeout(x, 100)); // equipe clica durante a consulta
    const manual = retryRefundNow(fin.ctx, { refundId: r.id }).catch((e: Error) => e.message);
    await Promise.all([auto, manual]);
    fake.control.getDelayMs = 0;
    fake.control.refundDelayMs = 0;
    expect(fake.control.requests.filter((x) => x.method === "POST" && x.path.endsWith("/refund"))).toHaveLength(2); // recusa inicial + 1 retentativa
    expect((await remoteOf(payment.id)).refunds).toHaveLength(1);
    expect(String(await manual)).toMatch(/processamento|aguardando/);
  });

  it("P17: estorno parado em 'autorização de ação crítica' (status real do sandbox) não conta como devolvido e gera alerta", async () => {
    const { payment, fin, op } = await captured();
    await ensureDefaultAlertRules(db, op.id);
    await db.alertRule.updateMany({ where: { operatorId: op.id, kind: "PAYMENT_DIVERGENCE" }, data: { includeNonProduction: true } });
    fake.control.refundStatus = "AWAITING_CRITICAL_ACTION_AUTHORIZATION";
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: "10", reason: "diferença" });
    expect(r).toMatchObject({ status: "REQUESTED", remoteStatus: "AWAITING_CRITICAL_ACTION_AUTHORIZATION" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded.toString()).toBe("0");
    expect(await retryDueRefunds(new Date(Date.now() + 86400_000))).toEqual([]); // não é reenviado
    await evaluateAlerts(op.id, new Date(Date.now() + 31 * 60_000));
    expect((await db.alert.findFirstOrThrow({ where: { dedupeKey: `refund-auth:${r.id}` } })).title).toMatch(/aguardando autorização/);
  });

  it("P16: acerto do fim da sessão no cartão é agendado (não abre análise) e conclui na retentativa", async () => {
    const { driver, station, call } = await setup();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1, method: "CARD" });
    const p0 = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p0.providerRef, "CONFIRMED");
    const h = hook("PAYMENT_CONFIRMED", p0.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    const start = (await call("cs", "StartTransaction", { connectorId: 1, idTag: req.idTag, meterStart: 0, timestamp: iso(new Date()) })) as { result: { transactionId: number } };
    fake.control.rejectRefund = NEXT_DAY;
    await call("ce", "StopTransaction", { transactionId: start.result.transactionId, meterStop: 10_000, timestamp: iso(new Date()) });
    const refund = await db.refund.findFirstOrThrow({ where: { paymentId: p0.id } });
    expect(refund).toMatchObject({ status: "SCHEDULED", requestedById: "system:settlement" });
    expect(refund.amount.toString()).toBe("30");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p0.id } })).reviewOpenedAt).toBeNull();
    fake.control.rejectRefund = null;
    await retryDueRefunds(new Date(refund.nextAttemptAt!.getTime() + 1000));
    expect((await db.payment.findUniqueOrThrow({ where: { id: p0.id } })).amountRefunded.toString()).toBe("30");
  });

  it("[14][15] estorno pendente no gateway não é concluído; webhook + consulta confirmam (DONE)", async () => {
    const { payment, fin } = await captured();
    fake.control.refundStatus = "PENDING";
    const r = await requestRefund(fin.ctx, { paymentId: payment.id, amount: 10, reason: "Cobrança indevida relatada" });
    expect(r).toMatchObject({ status: "REQUESTED", remoteStatus: "PENDING" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded.toString()).toBe("0");
    fake.completePendingRefunds(payment.providerRef);
    const h = hook("PAYMENT_PARTIALLY_REFUNDED", payment.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SUCCEEDED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded.toString()).toBe("10");
  });

  it("[15] estorno recusado pelo gateway fica FALHO e auditado", async () => {
    const { payment, fin } = await captured();
    fake.control.rejectRefund = "Saldo insuficiente para estorno.";
    await expect(requestRefund(fin.ctx, { paymentId: payment.id, amount: 5, reason: "Teste de recusa" })).rejects.toThrow(/Saldo insuficiente/);
    expect((await db.refund.findFirstOrThrow()).status).toBe("FAILED");
    expect(await db.auditEvent.count({ where: { action: "payment.refund_requested" } })).toBe(1);
  });

  it("[16] estorno duplicado/concorrente não ultrapassa o pago (considera estornos em andamento)", async () => {
    const { payment, fin } = await captured();
    fake.control.refundStatus = "PENDING";
    const results = await Promise.allSettled([
      requestRefund(fin.ctx, { paymentId: payment.id, amount: 40, reason: "Primeiro pedido" }),
      requestRefund(fin.ctx, { paymentId: payment.id, amount: 40, reason: "Pedido repetido" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: expect.stringMatching(/acima do disponível/) }) });
    expect((await remoteOf(payment.id)).refunds).toHaveLength(1);
  });

  it("[23][22] sem permissão não estorna; outra operadora não vê nem estorna", async () => {
    const { payment, support } = await captured();
    await expect(requestRefund(support.ctx, { paymentId: payment.id, amount: 1, reason: "tentativa sem permissão" })).rejects.toThrow(/permissão/);
    const op2 = await createOrg("Outra Operadora", "OPERATOR");
    const intruder = await createUser(op2.id, "admin");
    expect(await listPayments(intruder.ctx)).toEqual([]);
    await expect(getPayment(intruder.ctx, payment.id)).rejects.toThrow(/não encontrado/);
    await expect(requestRefund(intruder.ctx, { paymentId: payment.id, amount: 1, reason: "tentativa indevida" })).rejects.toThrow(/não encontrado/);
    expect((await listSplitConfig(intruder.ctx)).recipients).toEqual([]);
  });
});

describe("split", () => {
  async function withSplit(opts: { partnerPct?: number; fixedOther?: number } = {}) {
    const s = await setup();
    process.env.ASAAS_SPLIT_ENABLED = "1";
    const other = await createOrg("Investidor Fixo", "INVESTOR");
    await createSite(s.admin.ctx, { name: "Unidade do investidor", partnerOrganizationId: other.id });
    const r1 = await createRecipient(s.admin.ctx, { organizationId: s.partnerOrg.id, environment: "SANDBOX", walletId: W1, note: "walletId informado por e-mail do parceiro" });
    await expect(validateRecipient(s.admin.ctx, r1.id)).rejects.toThrow(/diferente/);
    await validateRecipient(s.admin2.ctx, r1.id);
    const participants: { kind: "SITE_PARTNER" | "RECIPIENT"; recipientId?: string; percentualValue?: number; fixedValue?: number }[] = [{ kind: "SITE_PARTNER", percentualValue: opts.partnerPct ?? 50 }];
    if (opts.fixedOther) {
      const r2 = await createRecipient(s.admin.ctx, { organizationId: other.id, environment: "SANDBOX", walletId: W2, note: "walletId conferido em contrato" });
      await validateRecipient(s.admin2.ctx, r2.id);
      participants.push({ kind: "RECIPIENT", recipientId: r2.id, fixedValue: opts.fixedOther });
    }
    const pol = await createSplitPolicy(s.fin.ctx, { effectiveFrom: new Date(Date.now() - 60_000), feeTreatment: "Percentual sobre o líquido do Asaas (após tarifa).", reason: "Política inicial", participants });
    await decideSplitPolicy(s.admin.ctx, pol.id, { approve: true });
    return { ...s, policy: pol };
  }

  it("[17] múltiplos participantes: split enviado com % sobre o líquido e valor fixo; cópia local versionada", async () => {
    const { driver, station, policy } = await withSplit({ fixedOther: 5 });
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! }, include: { splits: true } });
    expect(p).toMatchObject({ splitPolicyId: policy.id, splitPolicyVersion: 1 });
    expect(p.splits.map((x) => [x.walletId, x.percentualValue?.toString() ?? null, x.fixedValue?.toString() ?? null]).sort()).toEqual([[W1, "50", null], [W2, null, "5"]]);
    const remote = await remoteOf(p.id);
    expect(remote.split.map((x) => x.walletId).sort()).toEqual([W1, W2]);
    // 50% de 49,01 (líquido de 50,00 − 0,99) = 24,51 (Asaas calcula sobre netValue, NÃO 25,00 do bruto)
    fake.pay(p.providerRef);
    const h = hook("PAYMENT_RECEIVED", p.providerRef);
    await processWebhook("asaas", h.body, h.headers);
    const splits = await db.paymentSplit.findMany({ where: { paymentId: p.id } });
    expect(splits.find((x) => x.walletId === W1)?.totalValue?.toString()).toBe("24.51");
    expect(splits.every((x) => x.status === "AWAITING_CREDIT")).toBe(true);
  });

  it("[18] recebedor inválido: gateway recusa a carteira → cobrança não criada; recebedor não validado → sem split", async () => {
    const s = await withSplit();
    fake.control.rejectNextPayment = `A carteira ${W1} não foi encontrada.`;
    await expect(startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 })).rejects.toThrow(/carteira/);
    await expect(createRecipient(s.admin.ctx, { organizationId: s.partnerOrg.id, environment: "SANDBOX", walletId: "nao-e-uuid", note: "teste invalido" })).rejects.toThrow(/UUID/);
    process.env.ASAAS_OWN_WALLET_ID = W2;
    const other = await createOrg("Outro", "PARTNER");
    await createSite(s.admin.ctx, { name: "Unidade X", partnerOrganizationId: other.id });
    await expect(createRecipient(s.admin.ctx, { organizationId: other.id, environment: "SANDBOX", walletId: W2, note: "própria conta" })).rejects.toThrow(/própria conta/);
    delete process.env.ASAAS_OWN_WALLET_ID;
    await db.paymentRecipient.updateMany({ data: { status: "PENDING_VALIDATION" } });
    const req = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 }).catch(async () => {
      // pedido anterior falhou: um novo pedido é permitido
      return startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! }, include: { splits: true } });
    expect(p.splits).toHaveLength(0);
    expect(p.splitPolicyId).toBeNull();
  });

  it("[19][20] divergência e liquidação: bloqueio abre análise; PAYMENT_SPLIT_DONE liquida; conciliação aponta excesso", async () => {
    const { driver, station, admin } = await withSplit();
    const req = await startCharge(driver, { identity: station.ocppIdentity, connectorId: 1 });
    const p = await db.payment.findUniqueOrThrow({ where: { id: req.paymentId! } });
    fake.pay(p.providerRef);
    fake.settleSplits(p.providerRef, "BLOCKED_BY_VALUE_DIVERGENCE");
    const b = hook("PAYMENT_SPLIT_DIVERGENCE_BLOCK", p.providerRef);
    await processWebhook("asaas", b.body, b.headers);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).reviewReason).toMatch(/divergência de split/);
    let rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences.map((d) => d.kind)).toContain("SPLIT_DIVERGENCE");
    fake.settleSplits(p.providerRef, "DONE");
    const d = hook("PAYMENT_SPLIT_DONE", p.providerRef);
    await processWebhook("asaas", d.body, d.headers);
    const sp = await db.paymentSplit.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(sp.status).toBe("DONE");
    expect(sp.doneAt).not.toBeNull();
    // gateway informa split acima do líquido → divergência apontada (nunca corrigida automaticamente)
    fake.payments.get(p.providerRef)!.split[0].totalValue = 60;
    await refreshFromProvider(p.id, activeProvider());
    rec = await reconcile(admin.ctx, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });
    expect(rec.divergences.some((x) => x.kind === "SPLIT_DIVERGENCE" && /acima do líquido/.test(x.text))).toBe(true);
  });

  it("[29] nova política não é retroativa: cobrança existente mantém a versão aplicada", async () => {
    const s = await withSplit({ partnerPct: 50 });
    const r1 = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    await cancelChargeRequest(s.driver, r1.id);
    const v2 = await createSplitPolicy(s.fin.ctx, { effectiveFrom: new Date(Date.now() - 1000), feeTreatment: "Percentual sobre o líquido do Asaas.", reason: "Aditivo comercial 40%", participants: [{ kind: "SITE_PARTNER", percentualValue: 40 }] });
    await decideSplitPolicy(s.admin.ctx, v2.id, { approve: true });
    const r2 = await startCharge(s.driver, { identity: s.station.ocppIdentity, connectorId: 1 });
    const p1 = await db.payment.findUniqueOrThrow({ where: { id: r1.paymentId! }, include: { splits: true } });
    const p2 = await db.payment.findUniqueOrThrow({ where: { id: r2.paymentId! }, include: { splits: true } });
    expect([p1.splitPolicyVersion, p1.splits[0].percentualValue?.toString()]).toEqual([1, "50"]);
    expect([p2.splitPolicyVersion, p2.splits[0].percentualValue?.toString()]).toEqual([2, "40"]);
    await expect(createSplitPolicy(s.fin.ctx, { effectiveFrom: new Date(), feeTreatment: "x".repeat(12), reason: "Excesso", participants: [{ kind: "SITE_PARTNER", percentualValue: 60 }, { kind: "SITE_PARTNER", percentualValue: 50 }] })).rejects.toThrow(/ultrapassa 100%/);
  });
});

describe("painel do parceiro", () => {
  it("[22] parceiro vê somente as parcelas de split da própria organização", async () => {
    const s = await setup();
    const other = await createOrg("Outro Posto", "PARTNER");
    const pay = await db.payment.create({ data: { driverId: s.driver.driverId, operatorId: s.op.id, provider: "asaas", environment: "SANDBOX", providerRef: "pay_x", status: "CAPTURED", amountAuthorized: 50, amountCaptured: 50, method: "PIX" } });
    await db.paymentSplit.createMany({ data: [
      { paymentId: pay.id, operatorId: s.op.id, organizationId: s.partnerOrg.id, walletId: W1, percentualValue: 40, totalValue: 19.6, status: "DONE", externalReference: "k:split:1" },
      { paymentId: pay.id, operatorId: s.op.id, organizationId: other.id, walletId: W2, percentualValue: 10, totalValue: 4.9, status: "PENDING", externalReference: "k:split:2" },
    ] });
    const mine = await createUser(s.partnerOrg.id, "partner");
    const r = await partnerSplits(mine.ctx);
    expect(r.rows.map((x) => x.organizationId)).toEqual([s.partnerOrg.id]);
    expect(r.settledSandbox).toBe("19.60");
    expect(r.settledProduction).toBe("0.00");
    await expect(partnerSplits(s.admin.ctx)).rejects.toThrow(/permissão|exclusivo/);
  });
});

describe("configuração e ambientes", () => {
  it("P16: split habilitado sem política aprovada nem recebedor de produção bloqueia a produção (motivos explícitos)", async () => {
    const { op } = await setup();
    process.env.ASAAS_SPLIT_ENABLED = "1";
    try {
      const r = await productionReadiness(op.id);
      expect(r.allowed).toBe(false);
      expect(r.reasons.some((x) => /política de split aprovada/.test(x))).toBe(true);
      expect(r.reasons.some((x) => /recebedor de PRODUÇÃO/.test(x))).toBe(true);
    } finally {
      delete process.env.ASAAS_SPLIT_ENABLED;
    }
    expect((await productionReadiness(op.id)).reasons.some((x) => /split/i.test(x))).toBe(false);
  });

  it("[24][25] produção sem credenciais/habilitação fica bloqueada; sandbox funciona sem chave de produção", async () => {
    expect(readAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_SANDBOX_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv).ok).toBe(true);
    const prodNoKey = readAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_SANDBOX_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv);
    expect(prodNoKey.ok).toBe(false);
    expect(!prodNoKey.ok && prodNoKey.errors.join(" ")).toMatch(/ASAAS_PRODUCTION_API_KEY/);
    const prodNotEnabled = readAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_PRODUCTION_API_KEY: "p", ASAAS_WEBHOOK_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv);
    expect(!prodNotEnabled.ok && prodNotEnabled.errors.join(" ")).toMatch(/ASAAS_PRODUCTION_ENABLED/);
    const prodInTests = readAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_PRODUCTION_API_KEY: "p", ASAAS_PRODUCTION_ENABLED: "1", ASAAS_WEBHOOK_TOKEN: TOKEN, NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv);
    expect(!prodInTests.ok && prodInTests.errors.join(" ")).toMatch(/testes automatizados/);
    expect(readAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_SANDBOX_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "curto" } as unknown as NodeJS.ProcessEnv).ok).toBe(false);
    const op = await bootstrapOperator();
    const ready = await productionReadiness(op.id);
    expect(ready.allowed).toBe(false);
    expect(ready.reasons.join(" ")).toMatch(/sandbox/);
    const { station } = await (async () => {
      const admin = await createUser(op.id, "admin");
      const site = await createSite(admin.ctx, { name: "Prod", isPublic: true });
      const st = await createStation(admin.ctx, { siteId: site.id, ocppIdentity: `CP-PROD-${++seq}`, environment: "PRODUCTION" });
      await upsertConnector(admin.ctx, { stationId: st.station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
      return st;
    })();
    expect(await driverAwareAuthorizer.authorize("APP-QUALQUER", station)).toBe("Invalid");
  });
});

describe("fechamento mensal com pagamentos reais (produção simulada no banco de teste)", () => {
  it("[21][30] estornos e split descontados; ajuste posterior não altera o fechamento", async () => {
    const s = await setup();
    // Cenário de produção montado diretamente no banco de TESTE (nenhuma chamada a gateway real).
    await db.chargingStation.update({ where: { id: s.station.id }, data: { environment: "PRODUCTION" } });
    await createTaxRule(s.admin2.ctx, { name: "Simples", rate: 0.06, effectiveFrom: "2026-01-01T00:00:00-03:00" });
    const c = await createContract(s.admin.ctx, { contract: { partnerOrganizationId: s.partnerOrg.id, title: "50/50", siteIds: [s.site.id] }, terms: { effectiveFrom: "2026-01-01T00:00:00-03:00", royaltyRate: 0, royaltyBase: "GROSS_REVENUE", platformFeeRate: 0, partnerShareRate: 0.5, partnerShareBase: "NET_REVENUE", lossTreatment: "SHARE_MONTHLY", paymentTermDays: 10, conditions: "Partilha da receita líquida.", reason: "Contrato" } });
    await decideContractVersion(s.admin2.ctx, (await db.contractVersion.findFirstOrThrow({ where: { contractId: c.id } })).id, { approve: true });
    const session = await db.chargingSession.create({ data: { stationId: s.station.id, connectorId: 1, transactionId: 900, idTag: "X", environment: "PRODUCTION", meterStartWh: 0, meterStopWh: 10000, startedAt: new Date("2026-09-10T12:00:00-03:00"), stoppedAt: new Date("2026-09-10T13:00:00-03:00"), status: "COMPLETED", amount: "60", driverId: s.driver.driverId } });
    const pay = await db.payment.create({ data: { driverId: s.driver.driverId, operatorId: s.op.id, sessionId: session.id, provider: "asaas", environment: "PRODUCTION", providerRef: "pay_prod_1", method: "PIX", status: "PARTIALLY_REFUNDED", amountAuthorized: "100", amountCaptured: "100", amountRefunded: "40", netValue: "99.01", feeAmount: "0.99", reconciledAt: new Date() } });
    await db.paymentSplit.create({ data: { paymentId: pay.id, operatorId: s.op.id, organizationId: s.partnerOrg.id, walletId: W1, percentualValue: "20", totalValue: "19.80", externalReference: "k:split:1", status: "DONE", doneAt: new Date() } });
    const { result, validations } = await computeClosing(s.op.id, "2026-09");
    expect(validations.errors).toEqual([]);
    const line = result.lines[0];
    // bruto = 100 − 40 (estorno concluído) = 60; tributo 3,60; líquida 56,40; 50% = 28,20; já recebido via split 19,80 → saldo 8,40
    expect(line).toMatchObject({ gross: "60.00", taxTotal: "3.60", netRevenue: "56.40", partnerShare: "28.20", partnerSplitReceived: "19.80", partnerBalance: "8.40", gatewayFees: "0.99" });
    const req = await requestClosing(s.fin.ctx, "2026-09");
    await approveClosing(s.admin2.ctx, req.id);
    const entry = await db.financialEntry.findFirstOrThrow({ where: { closingId: req.id } });
    expect(entry.amount.toString()).toBe("8.4");
    expect(entry.description).toMatch(/descontado split já recebido R\$ 19.80/);
    expect(new Decimal(result.totals.partnerBalance).toFixed(2)).toBe("8.40");
  });
});
