/**
 * Mapeamento Asaas → estado local, conforme a documentação oficial (docs.asaas.com, consultada em 2026-10-27).
 * Sem I/O. O estado local SEMPRE vem da consulta autenticada da cobrança (GET /v3/payments/{id});
 * o evento de webhook só indica que algo mudou e qual transição é esperada.
 */
import Decimal from "decimal.js";

/** Status de cobrança documentados (PaymentGetResponsePaymentStatus). */
export const ASAAS_PAYMENT_STATUSES = [
  "PENDING", "RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED", "RECEIVED_IN_CASH", "REFUND_REQUESTED", "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL", "DUNNING_REQUESTED", "DUNNING_RECEIVED", "AWAITING_RISK_ANALYSIS",
] as const;
export type AsaasPaymentStatus = (typeof ASAAS_PAYMENT_STATUSES)[number];

/** Status de split documentados (LeanPaymentSplitGetResponsePaymentSplitStatus). */
/** Inclui REFUSED (status oficial "Split refused", docs.asaas.com, consultado em 2026-10-28). */
export const ASAAS_SPLIT_STATUSES = ["PENDING", "PROCESSING", "PROCESSING_REFUND", "AWAITING_CREDIT", "CANCELLED", "DONE", "REFUSED", "REFUNDED", "BLOCKED_BY_VALUE_DIVERGENCE"] as const;

/** Status de estorno documentados (PaymentRefundGetResponsePaymentRefundStatus). Concluído somente com DONE. */
export const ASAAS_REFUND_STATUSES = ["PENDING", "AWAITING_CRITICAL_ACTION_AUTHORIZATION", "AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION", "CANCELLED", "DONE"] as const;

export type LocalStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED" | "CANCELLED" | "DISPUTED";

export interface AsaasPaymentLike {
  id: string;
  status: string;
  value: number;
  netValue?: number | null;
  deleted?: boolean;
  refunds?: { status: string; value: number; description?: string | null; dateCreated?: string | null }[] | null;
}

/**
 * Pix é PRÉ-PAGO: não há reserva. CONFIRMED/RECEIVED = pago (capturado).
 * - PENDING/OVERDUE/AWAITING_RISK_ANALYSIS: aguardando (OVERDUE ainda pode ser pago: a remoção é feita pela WeMob);
 * - REFUND_REQUESTED/REFUND_IN_PROGRESS: pago, estorno ainda não concluído;
 * - chargeback: contestado; deleted=true: cancelado.
 */
export function mapAsaasPayment(p: AsaasPaymentLike): { status: LocalStatus; amountAuthorized: string; amountCaptured: string; amountRefunded: string; refundPending: boolean } {
  const value = new Decimal(p.value ?? 0);
  const refundedDone = (p.refunds ?? []).filter((r) => r.status === "DONE").reduce((a, r) => a.plus(r.value), new Decimal(0));
  const refundPending = (p.refunds ?? []).some((r) => r.status !== "DONE" && r.status !== "CANCELLED") || ["REFUND_REQUESTED", "REFUND_IN_PROGRESS"].includes(p.status);
  const base = { amountAuthorized: value.toFixed(2), amountRefunded: refundedDone.toFixed(2), refundPending };
  if (p.deleted) return { ...base, status: "CANCELLED", amountCaptured: "0.00" };
  switch (p.status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
    case "DUNNING_RECEIVED":
      return { ...base, status: refundedDone.gt(0) ? (refundedDone.gte(value) ? "REFUNDED" : "PARTIALLY_REFUNDED") : "CAPTURED", amountCaptured: value.toFixed(2) };
    case "REFUNDED":
      return { ...base, status: refundedDone.gt(0) && refundedDone.lt(value) ? "PARTIALLY_REFUNDED" : "REFUNDED", amountCaptured: value.toFixed(2), amountRefunded: (refundedDone.gt(0) ? refundedDone : value).toFixed(2) };
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return { ...base, status: "DISPUTED", amountCaptured: value.toFixed(2) };
    default:
      return { ...base, status: "PENDING", amountCaptured: "0.00" };
  }
}

/**
 * Tabela interna evento → transições locais esperadas. Usada para validar e registrar; o estado aplicado é o
 * da consulta ao provedor (nunca o conteúdo do evento). Evento fora da tabela é registrado e ignorado.
 */
export const ASAAS_EVENT_EXPECTATION: Record<string, { expects: LocalStatus[]; splitSync?: boolean; review?: string }> = {
  PAYMENT_CREATED: { expects: ["PENDING"] },
  PAYMENT_UPDATED: { expects: ["PENDING"] },
  PAYMENT_CONFIRMED: { expects: ["CAPTURED"] },
  PAYMENT_RECEIVED: { expects: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] },
  PAYMENT_OVERDUE: { expects: ["PENDING"] },
  PAYMENT_DELETED: { expects: ["CANCELLED"] },
  PAYMENT_RESTORED: { expects: ["PENDING"], review: "Cobrança restaurada no gateway depois de removida." },
  PAYMENT_REFUNDED: { expects: ["REFUNDED", "PARTIALLY_REFUNDED"] },
  PAYMENT_PARTIALLY_REFUNDED: { expects: ["PARTIALLY_REFUNDED"] },
  PAYMENT_REFUND_IN_PROGRESS: { expects: ["CAPTURED", "PARTIALLY_REFUNDED"] },
  PAYMENT_REFUND_DENIED: { expects: ["CAPTURED", "PARTIALLY_REFUNDED"], review: "Estorno negado pelo gateway." },
  PAYMENT_CHARGEBACK_REQUESTED: { expects: ["DISPUTED"], review: "Chargeback recebido." },
  PAYMENT_CHARGEBACK_DISPUTE: { expects: ["DISPUTED"] },
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: { expects: ["DISPUTED"] },
  PAYMENT_SPLIT_DONE: { expects: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"], splitSync: true },
  PAYMENT_SPLIT_CANCELLED: { expects: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"], splitSync: true, review: "Split cancelado no gateway." },
  PAYMENT_SPLIT_DIVERGENCE_BLOCK: { expects: ["CAPTURED"], splitSync: true, review: "Valor bloqueado por divergência de split (prazo de correção: 2 dias úteis)." },
  PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED: { expects: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"], splitSync: true, review: "Bloqueio por divergência de split encerrado: splits cancelados." },
};

/** Data de vencimento "hoje" no fuso da operação (AAAA-MM-DD). */
export function dueDateToday(now = new Date()) {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Marcador do estorno na descrição enviada ao Asaas (o estorno não tem externalReference). */
export const refundMarker = (refundId: string) => `[wemob:${refundId}]`;
