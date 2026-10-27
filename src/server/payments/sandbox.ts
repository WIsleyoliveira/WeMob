/**
 * GATEWAY SANDBOX — simulado, para desenvolvimento e testes sem credenciais.
 * Não movimenta dinheiro. Mantém estado próprio (SandboxGatewayCharge) para servir de "fonte de
 * verdade" externa e emite webhooks assinados com HMAC-SHA256 (PAYMENT_SANDBOX_WEBHOOK_SECRET).
 * Modos para teste: confirmação atrasada (autorização fica PENDING até webhook) e falha de rede.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Decimal from "decimal.js";
import { db } from "@/server/db";
import { ProviderUnavailableError, type PaymentProvider, type ProviderPayment, type ProviderStatus, type WebhookEvent } from "./provider";

export const SANDBOX_SIGNATURE_HEADER = "x-sandbox-signature";

export const sandboxControl = {
  delayAuthorization: false,
  failNetwork: false,
  declineAuthorization: false,
};

function secret() {
  const s = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
  if (!s) throw new ProviderUnavailableError("PAYMENT_SANDBOX_WEBHOOK_SECRET não configurado.");
  return s;
}

export function signSandbox(rawBody: string) {
  return createHmac("sha256", secret()).update(rawBody).digest("hex");
}

const toPayment = (c: { id: string; status: string; amount: Decimal.Value; captured: Decimal.Value; refunded: Decimal.Value }): ProviderPayment => ({
  providerRef: c.id,
  status: c.status as ProviderStatus,
  amountAuthorized: new Decimal(c.amount.toString()).toFixed(2),
  amountCaptured: new Decimal(c.captured.toString()).toFixed(2),
  amountRefunded: new Decimal(c.refunded.toString()).toFixed(2),
});

function net() {
  if (sandboxControl.failNetwork) throw new ProviderUnavailableError("Sandbox: falha de rede simulada.");
}

async function load(ref: string) {
  net();
  const c = await db.sandboxGatewayCharge.findUnique({ where: { id: ref } });
  if (!c) throw new Error("Sandbox: cobrança inexistente.");
  return c;
}

export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  environment: "SANDBOX",
  get status() {
    return process.env.PAYMENT_PROVIDER === "sandbox" && process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET ? ("configured" as const) : ("not_configured" as const);
  },
  async authorize(amount) {
    net();
    const status = sandboxControl.declineAuthorization ? "FAILED" : sandboxControl.delayAuthorization ? "PENDING" : "AUTHORIZED";
    return toPayment(await db.sandboxGatewayCharge.create({ data: { amount, status } }));
  },
  async capture(ref, amount) {
    const c = await load(ref);
    if (c.status !== "AUTHORIZED") throw new Error(`Sandbox: captura inválida em ${c.status}.`);
    if (new Decimal(amount).gt(c.amount.toString())) throw new Error("Sandbox: captura acima do autorizado.");
    return toPayment(await db.sandboxGatewayCharge.update({ where: { id: ref }, data: { captured: amount, status: new Decimal(amount).isZero() ? "CANCELLED" : "CAPTURED" } }));
  },
  async cancel(ref) {
    const c = await load(ref);
    if (!["AUTHORIZED", "PENDING"].includes(c.status)) throw new Error(`Sandbox: cancelamento inválido em ${c.status}.`);
    return toPayment(await db.sandboxGatewayCharge.update({ where: { id: ref }, data: { status: "CANCELLED" } }));
  },
  async refund(ref, amount) {
    const c = await load(ref);
    const refunded = new Decimal(c.refunded.toString()).plus(amount);
    if (refunded.gt(c.captured.toString())) throw new Error("Sandbox: reembolso acima do capturado.");
    const status = refunded.eq(c.captured.toString()) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return toPayment(await db.sandboxGatewayCharge.update({ where: { id: ref }, data: { refunded: refunded.toFixed(2), status } }));
  },
  async fetch(ref) {
    return toPayment(await load(ref));
  },
  parseWebhook(rawBody, headers): WebhookEvent {
    const sig = headers[SANDBOX_SIGNATURE_HEADER] ?? "";
    const expected = signSandbox(rawBody);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Assinatura do webhook inválida.");
    const body = JSON.parse(rawBody) as { id?: string; type?: string; data?: { ref?: string } };
    if (!body.id || !body.type || !body.data?.ref) throw new Error("Webhook sem id/type/ref.");
    return { eventId: body.id, type: body.type, providerRef: body.data.ref };
  },
};

/** Ferramenta de teste: altera o estado do sandbox e produz o webhook assinado correspondente. */
export async function sandboxSettle(ref: string, status: ProviderStatus) {
  await db.sandboxGatewayCharge.update({ where: { id: ref }, data: { status } });
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: `charge.${status.toLowerCase()}`, data: { ref } });
  return { body, headers: { [SANDBOX_SIGNATURE_HEADER]: signSandbox(body) } };
}
