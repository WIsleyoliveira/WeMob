/**
 * Criação da cobrança de uma recarga, por fluxo do provedor.
 *  - PREAUTH (sandbox local): reserva o valor máximo.
 *  - PREPAID (Asaas Pix ou cartão): cobrança com externalReference = chave idempotente do pedido (charge:<pedido>).
 *    Cartão é pago na página do próprio Asaas (invoiceUrl): dados do cartão nunca passam pela WeMob.
 * Timeout ou falha de comunicação após o envio NÃO gera nova cobrança: a chave é procurada no gateway
 * (GET /payments?externalReference). Sem resposta conclusiva, a operação fica UNKNOWN para a conciliação.
 */
import type { Payment, StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { log } from "@/server/log";
import { AppError } from "@/server/errors";
import { AsaasError } from "./asaas/client";
import type { createAsaasProvider } from "./asaas/provider";
import { ensureGatewayCustomer } from "./customers";
import { PAYMENT_METHOD_LABEL, ProviderUnavailableError, type PaymentProvider, type PrepaidMethod, type ProviderPayment } from "./provider";
import { resolveSplitForCharge } from "./split";
import { applyProviderState } from "./service";

export interface ChargeInput {
  provider: PaymentProvider;
  operatorId: string;
  siteId: string;
  stationEnvironment: StationEnvironment;
  driverId: string;
  chargeRequestId: string;
  amount: string;
  description: string;
  /** Forma pré-paga escolhida pelo motorista (padrão: Pix). Ignorada no fluxo PREAUTH. */
  method?: PrepaidMethod;
}

export const chargeKey = (chargeRequestId: string) => `charge:${chargeRequestId}`;

export async function createChargePayment(input: ChargeInput): Promise<Payment> {
  const { provider } = input;
  if (provider.flow !== "PREPAID") {
    const p = await provider.authorize(input.amount, { chargeRequestId: input.chargeRequestId, driverId: input.driverId });
    const payment = await db.payment.create({
      data: { driverId: input.driverId, operatorId: input.operatorId, provider: provider.name, environment: provider.environment, providerRef: p.providerRef, status: "PENDING", amountAuthorized: p.amountAuthorized, method: "PREAUTH" },
    });
    return (await applyProviderState(payment, p, "authorize")).payment;
  }
  const asaas = provider as ReturnType<typeof createAsaasProvider>;
  const key = chargeKey(input.chargeRequestId);
  const method: PrepaidMethod = input.method ?? "PIX";
  const billingType = method === "CARD" ? "CREDIT_CARD" : "PIX";
  try {
    await db.paymentOperation.create({ data: { key, kind: "CREATE_CHARGE", provider: provider.name, environment: provider.environment, operatorId: input.operatorId, chargeRequestId: input.chargeRequestId, request: { amount: input.amount, billingType } } });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      const existing = await db.payment.findUnique({ where: { externalReference: key } });
      if (existing) return existing;
      throw new AppError("CONFLICT", "Cobrança deste pedido já está sendo criada.");
    }
    throw e;
  }
  const customerRemoteId = await ensureGatewayCustomer(asaas, input.operatorId, input.driverId).catch(async (e) => {
    await db.paymentOperation.update({ where: { key }, data: { status: "FAILED", lastError: e instanceof Error ? e.message.slice(0, 300) : String(e) } });
    throw e;
  });
  const split = await resolveSplitForCharge({ operatorId: input.operatorId, siteId: input.siteId, environment: provider.environment, value: input.amount, chargeKey: key, splitEnabled: asaas.config.splitEnabled });
  if (!split.enabled) log.info("payment_split_skipped", { chargeRequestId: input.chargeRequestId, reason: split.reason });

  let remote: ProviderPayment | null = null;
  try {
    remote = await provider.authorize(input.amount, {}, { externalReference: key, customerRemoteId, description: input.description, billingType, split: split.enabled ? split.instructions : undefined });
  } catch (e) {
    const uncertain = (e instanceof AsaasError && e.kind === "TIMEOUT") || e instanceof ProviderUnavailableError;
    if (!uncertain) {
      await db.paymentOperation.update({ where: { key }, data: { status: "FAILED", lastError: e instanceof Error ? e.message.slice(0, 300) : String(e) } });
      throw new AppError("VALIDATION", e instanceof AsaasError && e.kind === "VALIDATION" ? `Cobrança recusada pelo Asaas: ${e.message}` : `Não foi possível criar a cobrança (${PAYMENT_METHOD_LABEL[method]}).`);
    }
    // Resultado incerto: verifica pela chave antes de qualquer outra ação.
    try {
      const found = await provider.findByExternalReference!(key);
      if (found.length > 1) log.error("payment_duplicate_remote_charges", { key, count: found.length });
      remote = found[0] ?? null;
    } catch {
      remote = null;
    }
    if (!remote) {
      await db.paymentOperation.update({ where: { key }, data: { status: "UNKNOWN", attempts: { increment: 1 }, lastError: "Sem resposta do gateway; cobrança não localizada pela chave." } });
      throw new AppError("VALIDATION", "O Asaas não confirmou a criação da cobrança. Nada foi cobrado por enquanto; a verificação segue na conciliação. Tente novamente em alguns minutos.");
    }
  }

  const payment = await db.payment.create({
    data: {
      driverId: input.driverId, operatorId: input.operatorId, provider: provider.name, environment: provider.environment, providerRef: remote.providerRef, status: "PENDING",
      amountAuthorized: remote.amountAuthorized, method, externalReference: key, invoiceUrl: remote.invoiceUrl ?? null,
      splitPolicyId: split.enabled ? split.policyId : null, splitPolicyVersion: split.enabled ? split.policyVersion : null,
      splits: split.enabled
        ? { create: split.instructions.map((x) => ({ operatorId: input.operatorId, organizationId: x.organizationId, recipientId: x.recipientId, walletId: x.walletId, percentualValue: x.percentualValue, fixedValue: x.fixedValue, externalReference: x.externalReference })) }
        : undefined,
    },
  });
  await db.paymentOperation.update({ where: { key }, data: { status: "SUCCEEDED", paymentId: payment.id, remoteId: remote.providerRef, response: { remoteStatus: remote.remoteStatus ?? null } } });
  if (method === "PIX") {
    try {
      const qr = await provider.getPixQrCode!(remote.providerRef);
      await db.payment.update({ where: { id: payment.id }, data: { pixPayload: qr.payload, pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate.replace(" ", "T") + (qr.expirationDate.length <= 19 ? "-03:00" : "")) : null } });
    } catch (e) {
      log.warn("pix_qrcode_unavailable", { paymentId: payment.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await audit({ organizationId: input.operatorId, action: "payment.charge_created", entityType: "Payment", entityId: payment.id, data: { method, environment: provider.environment, amount: remote.amountAuthorized, split: split.enabled ? { policyId: split.policyId, version: split.policyVersion } : { disabled: split.reason } } });
  return (await applyProviderState(await db.payment.findUniqueOrThrow({ where: { id: payment.id } }), remote, "create")).payment;
}

/** Atualiza a cobrança pré-paga a partir do gateway quando o motorista pede ("já paguei"). Nunca aceita confirmação do navegador. */
export async function refreshFromProvider(paymentId: string, provider: PaymentProvider) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const truth = await provider.fetch(payment.providerRef);
  return (await applyProviderState(payment, truth, "refresh")).payment;
}
