/**
 * Split — validação de política e estimativa de distribuição. Sem I/O.
 * Regras do Asaas (docs.asaas.com/docs/split-de-pagamentos): percentualValue (até 4 casas) incide sobre o
 * netValue (após tarifas); fixedValue até 2 casas; soma de percentuais ≤ 100%; fixo + percentual não pode
 * ultrapassar o líquido; a carteira emissora não entra no split (o resíduo fica nela).
 * Portanto 50% no split NÃO é 50% do valor bruto cobrado.
 */
import Decimal from "decimal.js";

export interface ParticipantRule {
  label: string;
  percentualValue?: string | number | null;
  fixedValue?: string | number | null;
}

export function validatePolicy(parts: ParticipantRule[]): string[] {
  const errors: string[] = [];
  if (!parts.length) errors.push("Inclua ao menos um participante.");
  let pct = new Decimal(0);
  for (const p of parts) {
    const hasPct = p.percentualValue !== null && p.percentualValue !== undefined && p.percentualValue !== "";
    const hasFix = p.fixedValue !== null && p.fixedValue !== undefined && p.fixedValue !== "";
    if (!hasPct && !hasFix) errors.push(`${p.label}: informe percentual ou valor fixo.`);
    if (hasPct) {
      const v = new Decimal(p.percentualValue!);
      if (v.lte(0) || v.gt(100)) errors.push(`${p.label}: percentual deve estar entre 0 e 100.`);
      if (v.decimalPlaces() > 4) errors.push(`${p.label}: percentual com no máximo 4 casas decimais.`);
      pct = pct.plus(v);
    }
    if (hasFix) {
      const v = new Decimal(p.fixedValue!);
      if (v.lte(0)) errors.push(`${p.label}: valor fixo deve ser positivo.`);
      if (v.decimalPlaces() > 2) errors.push(`${p.label}: valor fixo com no máximo 2 casas decimais.`);
    }
  }
  if (pct.gt(100)) errors.push(`Soma dos percentuais (${pct.toFixed(4)}%) ultrapassa 100%.`);
  return errors;
}

/**
 * Estimativa por participante sobre um líquido conhecido/estimado (arredondamento HALF_UP por linha).
 * O valor efetivo é o informado pelo gateway (PaymentSplit.totalValue). divergent=true quando a soma
 * ultrapassa o líquido — o Asaas bloqueia o valor (PAYMENT_SPLIT_DIVERGENCE_BLOCK).
 */
export function estimateDistribution(netValue: Decimal.Value, parts: ParticipantRule[]) {
  const net = new Decimal(netValue);
  const lines = parts.map((p) => {
    const fixed = p.fixedValue ? new Decimal(p.fixedValue) : new Decimal(0);
    const pct = p.percentualValue ? net.times(p.percentualValue).div(100) : new Decimal(0);
    return { label: p.label, amount: fixed.plus(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
  });
  const distributed = lines.reduce((a, l) => a.plus(l.amount), new Decimal(0));
  return { net: net.toFixed(2), lines: lines.map((l) => ({ ...l, amount: l.amount.toFixed(2) })), distributed: distributed.toFixed(2), residual: net.minus(distributed).toFixed(2), divergent: distributed.gt(net) };
}

/** Antes de criar a cobrança o líquido não é conhecido: valores fixos devem caber com folga no valor cobrado. */
export function validateForCharge(value: Decimal.Value, parts: ParticipantRule[]): string[] {
  const errors = validatePolicy(parts);
  const fixed = parts.reduce((a, p) => a.plus(p.fixedValue ? new Decimal(p.fixedValue) : 0), new Decimal(0));
  if (fixed.gte(value)) errors.push(`Valores fixos do split (${fixed.toFixed(2)}) não cabem no valor cobrado (${new Decimal(value).toFixed(2)}), que ainda terá tarifas descontadas.`);
  return errors;
}
