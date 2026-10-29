import Decimal from "decimal.js";
import { sessionLimit } from "./limit";

/**
 * B3 (P23) — compra da recarga por valor ou por kWh: regra pura PREPARATÓRIA, ainda NÃO conectada ao fluxo de
 * pagamento (o valor cobrado continua sendo PAYMENT_PREAUTH_AMOUNT). Não define limites comerciais: a faixa de
 * valores vem da configuração e, sem ela, a escolha fica bloqueada. Coerente com as regras em vigor:
 * limite da sessão = sessionLimit(valor, margem) (domain/charging/limit.ts) e valor apurado arredondado a
 * centavos (HALF_UP) em sessionAmount. Ver docs/P23_B3_ESPECIFICACAO.md.
 */

export type PurchaseRange = { status: "UNDEFINED"; reason: string } | { status: "DEFINED"; min: Decimal; max: Decimal };

/** Faixa de valores por recarga (decisão da WAPE). Sem padrão: ausente ou inválida → UNDEFINED. */
export function readPurchaseRange(env: Record<string, string | undefined>): PurchaseRange {
  const raw = { min: env.CHARGE_AMOUNT_MIN?.trim(), max: env.CHARGE_AMOUNT_MAX?.trim() };
  if (!raw.min || !raw.max) return { status: "UNDEFINED", reason: "Faixa de valores por recarga ainda não definida pela WAPE." };
  const ok = (v: string) => /^\d{1,6}(\.\d{1,2})?$/.test(v);
  if (!ok(raw.min) || !ok(raw.max)) return { status: "UNDEFINED", reason: "Faixa de valores mal configurada (use reais com até 2 casas decimais)." };
  const min = new Decimal(raw.min);
  const max = new Decimal(raw.max);
  if (min.lte(0) || max.lt(min)) return { status: "UNDEFINED", reason: "Faixa de valores mal configurada (mínimo deve ser positivo e não maior que o máximo)." };
  return { status: "DEFINED", min, max };
}

/**
 * Valor em reais digitado pelo cliente: só dígitos e, opcionalmente, vírgula ou ponto com até 2 casas.
 * `new Decimal` sozinho aceitaria "0x10" (16), "1e2" (100), "+50" e "1_000" — entradas ambíguas que poderiam
 * cobrar um valor diferente do que alguém leria. Retorna null para qualquer outra forma.
 */
const AMOUNT_RE = /^\d{1,6}(?:[.,]\d{1,2})?$/;
export function parseAmount(raw: string): Decimal | null {
  return AMOUNT_RE.test(raw) ? new Decimal(raw.replace(",", ".")) : null;
}

const brl = (d: Decimal) => `R$ ${d.toFixed(2).replace(".", ",")}`;

/** Valida o valor pedido pelo cliente contra a faixa. Sempre no servidor; o navegador só antecipa a mensagem. */
export function validatePurchaseAmount(amount: string, range: PurchaseRange): string[] {
  if (range.status === "UNDEFINED") return [range.reason];
  const v = parseAmount(amount);
  if (!v) return [/^\d{1,6}[.,]\d{3,}$/.test(amount) ? "Valor inválido (use reais com até 2 casas decimais)." : "Valor inválido."];
  if (v.lt(range.min)) return [`Valor abaixo do mínimo por recarga (${brl(range.min)}).`];
  if (v.gt(range.max)) return [`Valor acima do máximo por recarga (${brl(range.max)}).`];
  return [];
}

type Tariff = { pricePerKwh: Decimal.Value; pricePerMin: Decimal.Value };

/**
 * Por VALOR: o cliente paga `amount`; a recarga para no limite da sessão (valor − margem). A energia só é
 * estimável sem tarifa por minuto (com ela, depende da duração). Estimativa arredondada para BAIXO (nunca
 * promete mais energia do que o limite cobre).
 */
export function quoteByAmount(amount: Decimal.Value, tariff: Tariff, margin: number) {
  const charged = new Decimal(amount).toDecimalPlaces(2);
  const limit = sessionLimit(charged, margin);
  const perKwh = new Decimal(tariff.pricePerKwh);
  const timeTariff = new Decimal(tariff.pricePerMin).gt(0);
  const maxEnergyKwh = !timeTariff && perKwh.gt(0) ? limit.div(perKwh).toDecimalPlaces(3, Decimal.ROUND_DOWN) : null;
  return { charged, limit, maxEnergyKwh, estimateAvailable: maxEnergyKwh !== null };
}

/**
 * Por ENERGIA: menor valor (em centavos) cujo limite de sessão cobre `kwh` × tarifa. Indisponível com tarifa por
 * minuto ou sem preço por kWh: o custo da energia pedida não é determinável antes da recarga.
 */
export function quoteByEnergy(kwh: Decimal.Value, tariff: Tariff, margin: number) {
  const perKwh = new Decimal(tariff.pricePerKwh);
  if (new Decimal(tariff.pricePerMin).gt(0) || perKwh.lte(0)) return { supported: false as const, reason: "Compra por kWh indisponível nesta tarifa (há cobrança por minuto ou sem preço por kWh)." };
  const energy = new Decimal(kwh);
  const needed = energy.mul(perKwh).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let charged = needed.div(1 - margin).toDecimalPlaces(2, Decimal.ROUND_UP);
  while (sessionLimit(charged, margin).lt(needed)) charged = charged.plus("0.01"); // ajuste de centavo pelo ROUND_DOWN do limite
  return { supported: true as const, energyKwh: energy, energyCost: needed, charged, limit: sessionLimit(charged, margin) };
}
