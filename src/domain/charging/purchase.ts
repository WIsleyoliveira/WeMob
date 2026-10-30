import Decimal from "decimal.js";
import { sessionLimit } from "./limit";

/**
 * B3 (P23) — compra da recarga por valor (regra pura). Não define limites comerciais: a faixa vem da configuração
 * do AMBIENTE e, sem ela, a escolha fica desligada. Coerente com as regras em vigor: limite da sessão =
 * sessionLimit(valor, margem) (domain/charging/limit.ts) e valor apurado arredondado a centavos (HALF_UP) em
 * sessionAmount. Ver docs/P23_B3_ESPECIFICACAO.md e docs/P23_B3_DECISOES_WAPE.md.
 */

/**
 * Valores de EXEMPLO — NÃO COMERCIAIS. Só para desenvolvimento, demonstração e homologação SEM gateway de
 * produção (perfil CHARGE_AMOUNT_MODE=example). Não são limites nem preços da WAPE.
 */
export const B3_EXAMPLE = { min: "5.00", max: "500.00", suggested: "50.00", shortcuts: ["20.00", "50.00", "100.00"] } as const;

export type PurchaseConfig =
  | { status: "DISABLED"; reason: string }
  | { status: "ENABLED"; source: "EXAMPLE" | "CONFIGURED"; min: Decimal; max: Decimal; suggested: Decimal | null; shortcuts: Decimal[]; approvalRef: string | null };

/** Gateway de produção (dinheiro real): Asaas em "production" ou com a habilitação de produção ligada. */
export function isProductionGateway(env: Record<string, string | undefined>) {
  return (env.ASAAS_ENVIRONMENT ?? "").trim().toLowerCase() === "production" || env.ASAAS_PRODUCTION_ENABLED === "1";
}

/**
 * Configuração do B3 no ambiente. Seguro por padrão:
 *  - CHARGE_AMOUNT_MODE ausente/"off" → desligado;
 *  - "example" → valores B3_EXAMPLE, RECUSADO com gateway de produção (nunca vira fallback em produção);
 *  - "configured" → CHARGE_AMOUNT_MIN/MAX obrigatórios; com gateway de produção exige também
 *    CHARGE_AMOUNT_APPROVAL_REF (referência da aprovação formal da WAPE). Qualquer valor inválido → desligado.
 * Estações de PRODUÇÃO nunca usam o perfil de exemplo (ver `purchaseConfigForStation`).
 */
export function readPurchaseConfig(env: Record<string, string | undefined>): PurchaseConfig {
  const mode = (env.CHARGE_AMOUNT_MODE ?? "").trim().toLowerCase();
  if (mode === "" || mode === "off") return { status: "DISABLED", reason: "A recarga por valor não está disponível neste ambiente." };
  const production = isProductionGateway(env);
  if (mode === "example") {
    if (production) return { status: "DISABLED", reason: "Valores de exemplo não podem ser usados com gateway de produção." };
    return { status: "ENABLED", source: "EXAMPLE", min: new Decimal(B3_EXAMPLE.min), max: new Decimal(B3_EXAMPLE.max), suggested: new Decimal(B3_EXAMPLE.suggested), shortcuts: B3_EXAMPLE.shortcuts.map((v) => new Decimal(v)), approvalRef: null };
  }
  if (mode !== "configured") return { status: "DISABLED", reason: "Modo da recarga por valor desconhecido (use off, example ou configured)." };
  const range = readPurchaseRange(env);
  if (range.status === "UNDEFINED") return { status: "DISABLED", reason: range.reason };
  const approvalRef = env.CHARGE_AMOUNT_APPROVAL_REF?.trim() || null;
  if (production && !(approvalRef && /^[A-Za-z0-9._/-]{4,80}$/.test(approvalRef)))
    return { status: "DISABLED", reason: "Produção exige a referência da aprovação formal da WAPE (CHARGE_AMOUNT_APPROVAL_REF)." };
  const rawSuggested = env.CHARGE_AMOUNT_SUGGESTED?.trim();
  let suggested: Decimal | null = null;
  if (rawSuggested) {
    suggested = parseAmount(rawSuggested);
    if (!suggested || suggested.lt(range.min) || suggested.gt(range.max)) return { status: "DISABLED", reason: "Valor sugerido mal configurado (CHARGE_AMOUNT_SUGGESTED fora da faixa ou inválido)." };
  }
  return { status: "ENABLED", source: "CONFIGURED", min: range.min, max: range.max, suggested, shortcuts: suggested ? [suggested] : [], approvalRef };
}

/** O perfil de exemplo nunca vale para estação de PRODUÇÃO, mesmo fora do gateway de produção. */
export function purchaseConfigForStation(config: PurchaseConfig, stationEnvironment: "PRODUCTION" | "TEST" | "SIMULATED"): PurchaseConfig {
  if (config.status === "ENABLED" && config.source === "EXAMPLE" && stationEnvironment === "PRODUCTION") return { status: "DISABLED", reason: "Valores de exemplo não se aplicam a estações reais." };
  return config;
}

/** Converte a configuração em faixa (para a validação). */
export const rangeOf = (c: PurchaseConfig): PurchaseRange => (c.status === "ENABLED" ? { status: "DEFINED", min: c.min, max: c.max } : { status: "UNDEFINED", reason: c.reason });

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
