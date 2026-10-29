/**
 * Adapter do Asaas para o contrato PaymentProvider (fluxo PRÉ-PAGO via Pix).
 * Endpoints conforme a referência oficial (docs.asaas.com/reference, consultada em 2026-10-27):
 *   POST   /payments                 cria a cobrança (billingType PIX, externalReference, split[])
 *   GET    /payments/{id}            fonte de verdade do status
 *   GET    /payments?externalReference=…  recuperação após timeout / conciliação
 *   GET    /payments/{id}/pixQrCode  QR Code (encodedImage) e copia e cola (payload)
 *   DELETE /payments/{id}            remove cobrança pendente (Pix não pago na janela)
 *   POST   /payments/{id}/refund     estorno total/parcial {value, description}
 * Pix não tem pré-autorização: "capture" não move dinheiro; a diferença é devolvida por estorno.
 */
import { timingSafeEqual } from "node:crypto";
import Decimal from "decimal.js";
import { dueDateToday, mapAsaasPayment, type AsaasPaymentLike } from "@/domain/payments/asaas";
import { ProviderUnavailableError, type PaymentProvider, type ProviderPayment, type WebhookEvent } from "../provider";
import { AsaasClient, AsaasError, type FetchLike } from "./client";
import { readAsaasConfig, type AsaasConfig } from "./config";

export const ASAAS_WEBHOOK_HEADER = "asaas-access-token";

interface AsaasPayment extends AsaasPaymentLike {
  externalReference?: string | null;
  invoiceUrl?: string | null;
  dateCreated?: string | null;
  netValue?: number | null;
  split?: { id?: string; walletId: string; status: string; totalValue?: number | null; externalReference?: string | null; cancellationReason?: string | null }[] | null;
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? null : new Decimal(v).toFixed(2));

export function toProviderPayment(p: AsaasPayment): ProviderPayment {
  const m = mapAsaasPayment(p);
  return {
    providerRef: p.id,
    status: m.status,
    amountAuthorized: m.amountAuthorized,
    amountCaptured: m.amountCaptured,
    amountRefunded: m.amountRefunded,
    refundPending: m.refundPending,
    remoteStatus: p.deleted ? "DELETED" : p.status,
    netValue: money(p.netValue),
    refunds: (p.refunds ?? []).map((r) => ({ status: r.status, value: new Decimal(r.value).toFixed(2), description: r.description ?? null })),
    splits: (p.split ?? []).map((x) => ({ remoteId: x.id ?? null, walletId: x.walletId, status: x.status, totalValue: money(x.totalValue), externalReference: x.externalReference ?? null, cancellationReason: x.cancellationReason ?? null })),
    externalReference: p.externalReference ?? null,
    invoiceUrl: p.invoiceUrl ?? null,
    createdAt: p.dateCreated ?? null,
  };
}

/** Converte erros do cliente em erros do contrato (indisponível = pode tentar depois). */
function wrap(e: unknown): never {
  if (e instanceof AsaasError && (e.kind === "UNAVAILABLE" || e.kind === "RATE_LIMIT")) throw new ProviderUnavailableError(e.message);
  throw e;
}

export function createAsaasProvider(cfg: AsaasConfig, fetchImpl?: FetchLike): PaymentProvider & { client: AsaasClient; config: AsaasConfig } {
  const client = new AsaasClient(cfg, fetchImpl);
  const get = (id: string) => client.request<AsaasPayment>("GET", `/payments/${encodeURIComponent(id)}`).catch(wrap);
  return {
    name: "asaas",
    environment: cfg.environment,
    status: "configured",
    flow: "PREPAID",
    ackWebhookBeforeProcessing: true,
    client,
    config: cfg,

    async authorize(amount, _metadata, options) {
      if (!options?.customerRemoteId) throw new Error("Cliente do Asaas não informado.");
      const body = {
        customer: options.customerRemoteId,
        billingType: options.billingType ?? "PIX",
        value: Number(new Decimal(amount).toFixed(2)),
        dueDate: dueDateToday(),
        description: (options.description ?? "Recarga de veículo elétrico").slice(0, 500),
        externalReference: options.externalReference,
        ...(options.split?.length
          ? { split: options.split.map((x) => ({ walletId: x.walletId, ...(x.fixedValue ? { fixedValue: Number(x.fixedValue) } : {}), ...(x.percentualValue ? { percentualValue: Number(x.percentualValue) } : {}), externalReference: x.externalReference, description: x.description })) }
          : {}),
      };
      // TIMEOUT é repassado como está: o chamador deve verificar por externalReference antes de qualquer nova tentativa.
      const created = await client.request<AsaasPayment>("POST", "/payments", body).catch((e) => (e instanceof AsaasError && e.kind === "TIMEOUT" ? Promise.reject(e) : wrap(e)));
      return toProviderPayment(created);
    },

    /** Pré-pago: nada a capturar no gateway; devolve o estado atual (a diferença é tratada por estorno). */
    async capture(ref) {
      return toProviderPayment(await get(ref));
    },

    async cancel(ref) {
      try {
        await client.request("DELETE", `/payments/${encodeURIComponent(ref)}`);
      } catch (e) {
        // Cobrança já paga não pode ser removida: devolve o estado real para o chamador decidir.
        if (!(e instanceof AsaasError && e.kind === "VALIDATION")) wrap(e);
      }
      return toProviderPayment(await get(ref));
    },

    async refund(ref, amount, options) {
      const r = await client
        // Sem `value` o Asaas faz o estorno integral (docs "Estornar cobrança"); com valor é tratado como parcial,
        // que no cartão pode ser recusado ("só pode ser estornada parcialmente no próximo dia").
        .request<AsaasPayment>("POST", `/payments/${encodeURIComponent(ref)}/refund`, { ...(options?.full ? {} : { value: Number(new Decimal(amount).toFixed(2)) }), description: options?.description?.slice(0, 500) })
        .catch((e) => (e instanceof AsaasError && e.kind === "TIMEOUT" ? Promise.reject(e) : wrap(e)));
      return toProviderPayment(r);
    },

    async fetch(ref) {
      return toProviderPayment(await get(ref));
    },

    async findByExternalReference(externalReference) {
      const r = await client.request<{ data: AsaasPayment[] }>("GET", "/payments", undefined, { externalReference, limit: 10 }).catch(wrap);
      return (r.data ?? []).map(toProviderPayment);
    },

    /** Paginação limitada (100 por página, até 20 páginas) para respeitar a cota de 25.000 requisições/12 h. */
    async listRemote({ from, to }) {
      const out: ProviderPayment[] = [];
      for (let page = 0; page < 20; page++) {
        const r = await client
          .request<{ data: AsaasPayment[]; hasMore?: boolean }>("GET", "/payments", undefined, { "dateCreated[ge]": from.toISOString().slice(0, 10), "dateCreated[le]": to.toISOString().slice(0, 10), offset: page * 100, limit: 100 })
          .catch(wrap);
        out.push(...(r.data ?? []).map(toProviderPayment));
        if (!r.hasMore) break;
      }
      return out;
    },

    async getPixQrCode(ref) {
      const q = await client.request<{ encodedImage?: string; payload: string; expirationDate?: string }>("GET", `/payments/${encodeURIComponent(ref)}/pixQrCode`).catch(wrap);
      return { payload: q.payload, encodedImage: q.encodedImage, expirationDate: q.expirationDate ?? null };
    },

    /** Autenticação pelo header asaas-access-token (comparação em tempo constante). Evento: { id, event, payment? }. */
    parseWebhook(rawBody, headers): WebhookEvent {
      const got = Buffer.from(headers[ASAAS_WEBHOOK_HEADER] ?? "");
      const expected = Buffer.from(cfg.webhookToken);
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error("Token do webhook inválido.");
      const body = JSON.parse(rawBody) as { id?: string; event?: string; payment?: { id?: string } };
      if (!body.id || !body.event) throw new Error("Webhook sem id/event.");
      return { eventId: body.id, type: body.event, providerRef: body.payment?.id ?? "" };
    },
  };
}

let cached: { key: string; provider: ReturnType<typeof createAsaasProvider> } | null = null;
/** Provedor a partir do ambiente (memoizado por configuração). Lança erro claro se incompleto. */
export function asaasFromEnv() {
  const r = readAsaasConfig();
  if (!r.ok) throw new ProviderUnavailableError(`Asaas não configurado: ${r.errors.join(" ")}`);
  const key = `${r.config.environment}|${r.config.apiKey.length}|${r.config.webhookToken.length}|${r.config.splitEnabled}`;
  if (!cached || cached.key !== key) cached = { key, provider: createAsaasProvider(r.config, testFetch ?? undefined) };
  return cached.provider;
}

/** Somente testes automatizados: injeta um servidor Asaas falso (nunca a API real). */
let testFetch: FetchLike | null = null;
export function __setAsaasFetchForTests(f: FetchLike | null) {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST === undefined) throw new Error("Somente em testes.");
  testFetch = f;
  cached = null;
}
