import Decimal from "decimal.js";

/**
 * Limite financeiro da sessão (regra pura). A recarga não pode consumir além do que está coberto
 * (pré-pago: pago − estornado; pré-autorização: reservado). A margem reserva espaço para o atraso entre as
 * leituras do medidor e o tempo da parada remota, de modo que o valor final fique dentro da cobertura.
 */
export const DEFAULT_LIMIT_MARGIN = 0.1; // 10% da cobertura
export const MIN_LIMIT_MARGIN = 0.02;
export const MAX_LIMIT_MARGIN = 0.3;
/** Fração do limite a partir da qual a sessão é sinalizada como próxima do limite. */
export const LIMIT_WARN_AT = 0.9;

export function limitMargin(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) return DEFAULT_LIMIT_MARGIN;
  return Math.min(MAX_LIMIT_MARGIN, Math.max(MIN_LIMIT_MARGIN, n));
}

/** Limite = cobertura × (1 − margem), arredondado para baixo no centavo (nunca acima da cobertura). */
export function sessionLimit(funded: Decimal.Value, margin: number): Decimal {
  const f = new Decimal(funded);
  if (f.lte(0)) return new Decimal(0);
  return f.mul(1 - margin).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export type LimitState = "OK" | "NEAR" | "REACHED";

export function limitState(estimate: Decimal.Value, limit: Decimal.Value): LimitState {
  const e = new Decimal(estimate);
  const l = new Decimal(limit);
  if (e.gte(l)) return "REACHED";
  if (e.gte(l.mul(LIMIT_WARN_AT))) return "NEAR";
  return "OK";
}
