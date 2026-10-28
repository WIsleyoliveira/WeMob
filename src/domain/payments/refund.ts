/**
 * Classificação de falhas de estorno no gateway (regra pura, sem I/O).
 *
 *  - SCHEDULE: recusa temporária e conhecida — nova tentativa depois, consultando o gateway antes de reenviar.
 *      · Asaas, cartão: "Esta transação só pode ser estornada parcialmente no próximo dia." (sandbox, 2026-10-28)
 *      · limite de requisições (429/403 temporário)
 *  - VERIFY: resultado incerto (timeout, rede, HTTP 5xx depois do envio) — o estorno pode ter sido processado.
 *      Nunca reenviar sem antes consultar o gateway pelo marcador do estorno.
 *  - FAIL: recusa definitiva (validação, autenticação) — estorno FALHO e pagamento em análise.
 */
export type RefundFailureKind = "VALIDATION" | "AUTH" | "RATE_LIMIT" | "UNAVAILABLE" | "TIMEOUT" | "NOT_FOUND" | "UNKNOWN";
export type RefundDecision = { action: "SCHEDULE" | "VERIFY" | "FAIL"; retryAt: Date | null; reason: string };

/** Envios no total (o primeiro inclusive). Esgotado → FALHO + análise humana. */
export const MAX_REFUND_ATTEMPTS = 5;
/** Espera antes de consultar um resultado incerto ou repetir após limite de requisições. */
export const REFUND_VERIFY_DELAY_MS = 15 * 60_000;

const NEXT_DAY = /pr[oó]xim[oa]\s+dia|next\s+day|dia\s+seguinte/i;

/**
 * Próxima manhã em Brasília (06:00, UTC−3 — sem horário de verão desde 2019) estritamente após `now`.
 * Usado para a regra "estorno parcial só no dia seguinte".
 */
export function nextMorningBrasilia(now: Date): Date {
  const BRT_OFFSET_MS = 3 * 3600_000;
  const local = new Date(now.getTime() - BRT_OFFSET_MS);
  const nextLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(nextLocalMidnight + 6 * 3600_000 + BRT_OFFSET_MS);
}

export function classifyRefundFailure(kind: RefundFailureKind, message: string, now: Date): RefundDecision {
  const reason = message.slice(0, 300);
  if (kind === "VALIDATION" && NEXT_DAY.test(message)) return { action: "SCHEDULE", retryAt: nextMorningBrasilia(now), reason };
  if (kind === "RATE_LIMIT") return { action: "SCHEDULE", retryAt: new Date(now.getTime() + REFUND_VERIFY_DELAY_MS), reason };
  if (kind === "TIMEOUT" || kind === "UNAVAILABLE") return { action: "VERIFY", retryAt: new Date(now.getTime() + REFUND_VERIFY_DELAY_MS), reason };
  return { action: "FAIL", retryAt: null, reason };
}
