/**
 * Dados de teste do E2E, criados pelos serviços do próprio app no banco TEMPORÁRIO (nunca em outro banco).
 * Gateway: provedor local simulado (sandbox). Nenhum dado real, nenhum gateway real.
 */
import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { login, resolveSession } from "@/server/auth/session";
import { ensureOperator, ensureReferenceModels, ensureStages, ensureSystemRoles } from "@/server/bootstrap";
import { addTariff, createSite, createStation, upsertConnector } from "@/server/modules/stations/service";
import { signupDriver } from "@/server/drivers/auth";
import { sandboxProvider } from "@/server/payments/sandbox";
import { ensureDefaultAlertRules } from "@/server/modules/alerts/rules";

export type E2EFixtures = Awaited<ReturnType<typeof seedE2E>>;

export async function seedE2E() {
  if (!process.env.DATABASE_URL?.includes("sansol_e2e_")) throw new Error("seedE2E só roda no banco E2E temporário.");
  // Sempre letras e números (a validação de senha exige os dois).
  const password = () => `${randomBytes(18).toString("base64url")}Aa1`;
  await ensureSystemRoles(db);
  const op = await ensureOperator(db);
  await ensureStages(db, op.id);
  await ensureReferenceModels(db, op.id);
  await ensureDefaultAlertRules(db, op.id);
  await db.alertRule.updateMany({ where: { operatorId: op.id }, data: { includeNonProduction: true } });

  async function staff(key: string, organizationId: string) {
    const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key } });
    const pw = password();
    const email = `e2e.${key}.${randomBytes(3).toString("hex")}@teste.local`;
    const user = await db.user.create({ data: { email, name: `E2E ${key}`, passwordHash: await hashPassword(pw) } });
    await db.membership.create({ data: { userId: user.id, organizationId, roleId: role.id } });
    return { email, password: pw, userId: user.id };
  }
  const admin = await staff("superadmin", op.id);
  const finance = await staff("finance", op.id);
  const partnerA = await db.organization.create({ data: { name: "Parceiro A (E2E)", kind: "PARTNER" } });
  const partnerB = await db.organization.create({ data: { name: "Parceiro B (E2E)", kind: "PARTNER" } });
  const partnerUserA = await staff("partner", partnerA.id);
  const { token } = await login({ email: admin.email, password: admin.password });
  const ctx = (await resolveSession(token))!;

  const siteA = await createSite(ctx, { name: "Posto A (E2E)", isPublic: true, partnerOrganizationId: partnerA.id });
  const siteB = await createSite(ctx, { name: "Posto B (E2E)", isPublic: true, partnerOrganizationId: partnerB.id });
  const { station } = await createStation(ctx, { siteId: siteA.id, ocppIdentity: `TEST-E2E-${randomBytes(2).toString("hex").toUpperCase()}`, environment: "TEST", heartbeatInterval: 3600 });
  await upsertConnector(ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
  await addTariff(ctx, { siteId: siteA.id, pricePerKwh: 2, pricePerMin: 0, validFrom: new Date(Date.now() - 86400000) });
  await db.chargingStation.update({ where: { id: station.id }, data: { connectionState: "CONNECTED", lastSeenAt: new Date() } });
  await db.connector.updateMany({ where: { stationId: station.id }, data: { status: "AVAILABLE", statusAt: new Date(), statusReceivedAt: new Date() } });

  // P23 B2: estações SIMULADAS (aba Demonstração) para a descoberta — coordenadas, conectores e preços distintos.
  async function demoStation(name: string, city: string, lat: number, lon: number, connector: { type: "CCS2" | "TYPE2"; maxPowerKw: number }, pricePerKwh: number, fresh: boolean) {
    const site = await createSite(ctx, { name, city, state: city === "São Paulo" ? "SP" : "RJ", isPublic: false, latitude: lat, longitude: lon });
    const { station: st } = await createStation(ctx, { siteId: site.id, ocppIdentity: `SIM-E2E-${randomBytes(2).toString("hex").toUpperCase()}`, environment: "SIMULATED", heartbeatInterval: 3600 });
    await upsertConnector(ctx, { stationId: st.id, connectorId: 1, ...connector });
    await addTariff(ctx, { siteId: site.id, pricePerKwh, pricePerMin: 0, validFrom: new Date(Date.now() - 86400000) });
    const seen = fresh ? new Date() : new Date(Date.now() - 3 * 86400000);
    await db.chargingStation.update({ where: { id: st.id }, data: { connectionState: fresh ? "CONNECTED" : "DISCONNECTED", lastSeenAt: seen } });
    await db.connector.updateMany({ where: { stationId: st.id }, data: { status: "AVAILABLE", statusAt: seen, statusReceivedAt: seen } });
    return { name, identity: st.ocppIdentity };
  }
  const demo = {
    spFast: await demoStation("Demo SP Rápido (E2E)", "São Paulo", -23.5505, -46.6333, { type: "CCS2", maxPowerKw: 60 }, 2, true),
    rjType2: await demoStation("Demo RJ Tipo 2 (E2E)", "Rio de Janeiro", -22.9068, -43.1729, { type: "TYPE2", maxPowerKw: 22 }, 1.5, true),
    spOffline: await demoStation("Demo SP Sem Sinal (E2E)", "São Paulo", -23.56, -46.65, { type: "CCS2", maxPowerKw: 150 }, 2.5, false),
  };

  async function driver(name: string) {
    const pw = password();
    const email = `e2e.motorista.${randomBytes(3).toString("hex")}@teste.local`;
    await signupDriver({ name, email, password: pw, consent: true });
    const d = await db.driver.findUniqueOrThrow({ where: { email } });
    return { email, password: pw, driverId: d.id };
  }
  const driverA = await driver("Motorista A E2E");
  const driverB = await driver("Motorista B E2E");

  /** Pagamento capturado no gateway local simulado (para telas de pagamento e estorno). */
  async function capturedPayment(amount: string) {
    const auth = await sandboxProvider.authorize(amount, {});
    const cap = await sandboxProvider.capture(auth.providerRef, amount);
    return db.payment.create({
      data: { driverId: driverA.driverId, operatorId: op.id, provider: "sandbox", environment: "SANDBOX", providerRef: cap.providerRef, status: "CAPTURED", method: "PREAUTH", amountAuthorized: amount, amountCaptured: amount },
    });
  }
  const payRefund = await capturedPayment("50.00");
  const payStates = await capturedPayment("40.00");
  const payScheduledFuture = await capturedPayment("30.00");
  const payScheduledDue = await capturedPayment("30.00");
  const paySplit = await capturedPayment("100.00");
  const now = Date.now();
  await db.refund.createMany({
    data: [
      { paymentId: payStates.id, amount: "5.00", reason: "E2E pendente", requestedById: "system:e2e", status: "REQUESTED", remoteStatus: "PENDING" },
      { paymentId: payStates.id, amount: "6.00", reason: "E2E incerto", requestedById: "system:e2e", status: "REQUESTED", remoteStatus: "UNKNOWN", nextAttemptAt: new Date(now + 15 * 60_000), lastError: "Tempo esgotado aguardando o gateway." },
      { paymentId: payStates.id, amount: "7.00", reason: "E2E autorizacao", requestedById: "system:e2e", status: "REQUESTED", remoteStatus: "AWAITING_CRITICAL_ACTION_AUTHORIZATION" },
      { paymentId: payStates.id, amount: "8.00", reason: "E2E recusado", requestedById: "system:e2e", status: "FAILED", remoteStatus: "REJECTED", lastError: "Recusado pelo gateway (E2E)." },
      { paymentId: payScheduledFuture.id, amount: "10.00", reason: "E2E agendado futuro", requestedById: "system:e2e", status: "SCHEDULED", remoteStatus: "RETRY_LATER", nextAttemptAt: new Date(now + 20 * 3600_000), lastError: "Esta transação só pode ser estornada parcialmente no próximo dia." },
      { paymentId: payScheduledDue.id, amount: "10.00", reason: "E2E agendado vencido", requestedById: "system:e2e", status: "SCHEDULED", remoteStatus: "RETRY_LATER", nextAttemptAt: new Date(now - 60_000), lastError: "Esta transação só pode ser estornada parcialmente no próximo dia." },
    ],
  });
  const recipient = await db.paymentRecipient.create({
    data: { operatorId: op.id, organizationId: partnerA.id, environment: "SANDBOX", walletId: "00000000-0000-4000-8000-00000000e2e0", note: "Recebedor fictício do E2E (banco temporário; não é carteira real)", status: "ACTIVE", createdById: admin.userId },
  });
  await db.paymentSplit.create({ data: { paymentId: paySplit.id, operatorId: op.id, organizationId: partnerA.id, recipientId: recipient.id, walletId: recipient.walletId, percentualValue: "50", status: "REFUSED", externalReference: `split:e2e:${paySplit.id}` } });
  await db.payment.update({ where: { id: paySplit.id }, data: { netValue: "97.52", feeAmount: "2.48" } });

  await db.session.updateMany({ where: { userId: admin.userId }, data: { revokedAt: new Date() } }); // sessão usada só para montar os dados
  return {
    operatorId: op.id,
    admin: { email: admin.email, password: admin.password },
    finance: { email: finance.email, password: finance.password },
    partnerA: { email: partnerUserA.email, password: partnerUserA.password },
    siteA: siteA.id,
    siteB: siteB.id,
    station: { id: station.id, identity: station.ocppIdentity },
    demo,
    driverA,
    driverB,
    payments: { refund: payRefund.id, states: payStates.id, scheduledFuture: payScheduledFuture.id, scheduledDue: payScheduledDue.id, split: paySplit.id },
    sandboxRefs: { refund: payRefund.providerRef, scheduledDue: payScheduledDue.providerRef, scheduledFuture: payScheduledFuture.providerRef },
  };
}
