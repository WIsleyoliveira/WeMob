/**
 * Motor de apuração mensal (royalties e repasses) — regras puras, sem I/O.
 *
 * Por unidade (site), com as condições da versão de contrato APROVADA vigente no período:
 *   bruto              = receita de recarga (capturada − reembolsada + lançada externamente) + outras receitas
 *   tributo_i          = bruto × alíquota_i                      (regras de tributo vigentes)
 *   taxa de sistema    = bruto × taxa de sistema do contrato     (inclui gateway; 0 sem contrato)
 *   receita líquida    = bruto − Σ tributos − taxa de sistema
 *   royalty            = base_royalty × taxa de royalty          (base: bruto ou receita líquida)
 *   custos             = Σ despesas lançadas na unidade
 *   resultado operac.  = receita líquida − custos − royalty
 *   base do repasse    = bruto | receita líquida | resultado operacional (− prejuízo acumulado, se compensação)
 *   repasse            = base × participação do parceiro
 *     · base negativa + rateio mensal  → repasse negativo = aporte devido pelo parceiro
 *     · base negativa + compensação    → repasse 0 e prejuízo levado ao próximo período
 *   resultado da operadora = resultado operacional − repasse
 *   já repassado via split = Σ splits LIQUIDADOS (DONE) do parceiro no período (Asaas)
 *   saldo do repasse  = repasse − já repassado via split   (positivo: a pagar; negativo: a receber do parceiro)
 *   tarifas do gateway = Σ (valor − líquido) informado pelo gateway — informativo: cobertas pela taxa de sistema
 *
 * Modelo de PARTICIPAÇÃO sobre o bruto (contrato com `revenueShareRate`, ex.: 30/70 — regra oficial WAPE de 2026-11):
 *   participação WeMob = bruto elegível × taxa (arredondada); parte do posto = bruto − participação WeMob
 *     (pelo resto: as duas partes somam exatamente o bruto, sem centavo criado ou perdido)
 *   tarifas reais do gateway: descontadas conforme `gatewayFeeBearer` (WeMob, posto ou proporcional);
 *     PENDING_DECISION = não alocadas (o fechamento não pode ser aprovado com tarifas não alocadas)
 *   tributos e despesas da unidade: exibidos À PARTE e NÃO descontados de nenhuma das partes (a participação não é lucro)
 *   royalty, taxa de sistema e compensação de prejuízo não se aplicam
 *   bruto elegível = capturado − estornado (nunca valor só autorizado ou estornado depois): o que não foi recebido não é repartido
 * Cada linha é arredondada a 2 casas (ROUND_HALF_UP) e os totais somam as linhas arredondadas.
 * Resultado gerencial: não substitui escrituração contábil nem apuração fiscal.
 */
import Decimal from "decimal.js";

/**
 * 1.1.0: receita de recarga lançada manualmente passa a compor "receita de recarga" (antes: "outras receitas").
 * 1.2.0: split liquidado no gateway é descontado do repasse (saldo do repasse) e tarifas reais do gateway são exibidas.
 * 1.3.0: modelo de participação sobre o bruto (30/70) com alocação explícita das tarifas do gateway.
 */
export const SETTLEMENT_ENGINE_VERSION = "settlement-1.3.0";

export type GatewayFeeBearer = "PENDING_DECISION" | "WEMOB" | "PARTNER" | "PROPORTIONAL";
export const GATEWAY_FEE_BEARER_LABEL: Record<GatewayFeeBearer, string> = {
  PENDING_DECISION: "A definir (decisão da WAPE)",
  WEMOB: "WeMob (desconta da participação da WeMob)",
  PARTNER: "Posto (desconta da parte do posto)",
  PROPORTIONAL: "Proporcional à participação",
};

/** Divisão do bruto no modelo de participação, com conservação de centavos (as partes somam o bruto). */
export function splitGross(gross: Decimal.Value, wemobRate: Decimal.Value) {
  const g = r2(D(gross));
  const wemob = r2(g.times(wemobRate));
  return { gross: g.toFixed(2), wemob: wemob.toFixed(2), partner: g.minus(wemob).toFixed(2) };
}

export type Base = "GROSS_REVENUE" | "NET_REVENUE" | "OPERATING_RESULT";
export type LossTreatment = "SHARE_MONTHLY" | "CARRY_FORWARD";

export interface ContractTerms {
  contractId: string;
  contractNumber: string;
  versionId: string;
  version: number;
  royaltyRate: string;
  royaltyBase: Base;
  platformFeeRate: string;
  partnerShareRate: string;
  partnerShareBase: Base;
  lossTreatment: LossTreatment;
  paymentTermDays: number;
  /** Modelo de participação: fração da WeMob sobre o bruto elegível. Ausente/nulo = modelo royalty + taxa + repasse. */
  revenueShareRate?: string | null;
  gatewayFeeBearer?: GatewayFeeBearer;
}

export interface SiteInput {
  siteId: string;
  siteName: string;
  partnerOrganizationId: string | null;
  partnerName: string | null;
  contract: ContractTerms | null;
  stations: { stationId: string; identity: string; chargingRevenue: string; paymentCount: number }[];
  /** Receitas lançadas manualmente (competência do período). */
  manualRevenue: { category: string; amount: string }[];
  expenses: { category: string; amount: string }[];
  /** Prejuízo acumulado vindo do fechamento anterior (compensação). */
  lossCarriedIn: string;
  /** Valores já transferidos ao parceiro pelo split do gateway (liquidados) nas cobranças do período. */
  splitAlreadyTransferred?: string;
  /** Tarifas cobradas pelo gateway nas cobranças do período (informativo). */
  gatewayFees?: string;
}

export interface SiteLine {
  siteId: string;
  siteName: string;
  partnerOrganizationId: string | null;
  partnerName: string | null;
  contract: ContractTerms | null;
  stations: { stationId: string; identity: string; chargingRevenue: string; paymentCount: number }[];
  chargingRevenue: string;
  otherRevenue: string;
  gross: string;
  taxes: { name: string; rate: string; amount: string }[];
  taxTotal: string;
  platformFee: string;
  netRevenue: string;
  royalty: string;
  expensesByCategory: Record<string, string>;
  expenses: string;
  operatingResult: string;
  lossCarriedIn: string;
  partnerShareBaseValue: string;
  partnerShare: string;
  lossCarriedOut: string;
  operatorResult: string;
  partnerSplitReceived: string;
  partnerBalance: string;
  gatewayFees: string;
  /** Modelo de participação (ausente em snapshots anteriores à 1.3.0). */
  shareModel?: "REVENUE_SHARE" | "LEGACY";
  /** Participação da WeMob sobre o bruto, ANTES de tarifas, tributos e custos. */
  wemobShare?: string;
  /** Parte do posto sobre o bruto, antes das tarifas que couberem a ele. */
  partnerGrossShare?: string;
  gatewayFeesWemob?: string;
  gatewayFeesPartner?: string;
  gatewayFeesUnallocated?: string;
}

const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const s2 = (v: Decimal) => r2(v).toFixed(2);
const sum = (xs: Decimal.Value[]) => xs.reduce<Decimal>((a, x) => a.plus(x), D(0));

export function computeSiteLine(site: SiteInput, taxRules: { name: string; rate: string }[]): SiteLine {
  const c = site.contract;
  if (c?.revenueShareRate !== undefined && c.revenueShareRate !== null && site.partnerOrganizationId) return revenueShareLine(site, c, taxRules);
  const manualCharging = site.manualRevenue.filter((x) => x.category === "CHARGING_REVENUE").map((x) => x.amount);
  const chargingRevenue = r2(sum([...site.stations.map((s) => s.chargingRevenue), ...manualCharging]));
  const otherRevenue = r2(sum(site.manualRevenue.filter((x) => x.category !== "CHARGING_REVENUE").map((x) => x.amount)));
  const gross = chargingRevenue.plus(otherRevenue);
  const taxes = taxRules.map((t) => ({ name: t.name, rate: t.rate, amount: s2(gross.times(t.rate)) }));
  const taxTotal = sum(taxes.map((t) => t.amount));
  const platformFee = c ? r2(gross.times(c.platformFeeRate)) : D(0);
  const netRevenue = gross.minus(taxTotal).minus(platformFee);
  const royaltyBaseValue = !c ? D(0) : c.royaltyBase === "GROSS_REVENUE" ? gross : netRevenue;
  const royalty = c ? r2(royaltyBaseValue.times(c.royaltyRate)) : D(0);
  const expensesByCategory: Record<string, Decimal> = {};
  for (const e of site.expenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? D(0)).plus(e.amount);
  const expenses = r2(sum(Object.values(expensesByCategory)));
  const operatingResult = netRevenue.minus(expenses).minus(royalty);

  let lossCarriedIn = D(0);
  let baseValue = D(0);
  let partnerShare = D(0);
  let lossCarriedOut = D(0);
  if (c && site.partnerOrganizationId) {
    const carry = c.partnerShareBase === "OPERATING_RESULT" && c.lossTreatment === "CARRY_FORWARD";
    lossCarriedIn = carry ? D(site.lossCarriedIn) : D(0);
    baseValue = c.partnerShareBase === "GROSS_REVENUE" ? gross : c.partnerShareBase === "NET_REVENUE" ? netRevenue : operatingResult.minus(lossCarriedIn);
    if (baseValue.lt(0) && carry) {
      lossCarriedOut = baseValue.neg();
      partnerShare = D(0);
    } else {
      partnerShare = r2(baseValue.times(c.partnerShareRate));
    }
  }
  const fx = (o: Record<string, Decimal>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, s2(v)]));
  return {
    siteId: site.siteId,
    siteName: site.siteName,
    partnerOrganizationId: site.partnerOrganizationId,
    partnerName: site.partnerName,
    contract: c,
    stations: site.stations.map((s) => ({ ...s, chargingRevenue: s2(D(s.chargingRevenue)) })),
    chargingRevenue: s2(chargingRevenue),
    otherRevenue: s2(otherRevenue),
    gross: s2(gross),
    taxes,
    taxTotal: s2(taxTotal),
    platformFee: s2(platformFee),
    netRevenue: s2(netRevenue),
    royalty: s2(royalty),
    expensesByCategory: fx(expensesByCategory),
    expenses: s2(expenses),
    operatingResult: s2(operatingResult),
    lossCarriedIn: s2(lossCarriedIn),
    partnerShareBaseValue: s2(baseValue),
    partnerShare: s2(partnerShare),
    lossCarriedOut: s2(lossCarriedOut),
    operatorResult: s2(operatingResult.minus(partnerShare)),
    partnerSplitReceived: s2(D(site.splitAlreadyTransferred ?? 0)),
    partnerBalance: s2(partnerShare.minus(site.splitAlreadyTransferred ?? 0)),
    gatewayFees: s2(D(site.gatewayFees ?? 0)),
  };
}

/** Linha no modelo de participação sobre o bruto (ver cabeçalho). */
function revenueShareLine(site: SiteInput, c: ContractTerms, taxRules: { name: string; rate: string }[]): SiteLine {
  const manualCharging = site.manualRevenue.filter((x) => x.category === "CHARGING_REVENUE").map((x) => x.amount);
  const chargingRevenue = r2(sum([...site.stations.map((s) => s.chargingRevenue), ...manualCharging]));
  const otherRevenue = r2(sum(site.manualRevenue.filter((x) => x.category !== "CHARGING_REVENUE").map((x) => x.amount)));
  const gross = chargingRevenue.plus(otherRevenue);
  const split = splitGross(gross, c.revenueShareRate!);
  const fees = r2(D(site.gatewayFees ?? 0));
  const bearer = c.gatewayFeeBearer ?? "PENDING_DECISION";
  let feeWemob = D(0);
  let feePartner = D(0);
  if (bearer === "WEMOB") feeWemob = fees;
  else if (bearer === "PARTNER") feePartner = fees;
  else if (bearer === "PROPORTIONAL") {
    feeWemob = r2(fees.times(c.revenueShareRate!));
    feePartner = fees.minus(feeWemob);
  }
  const unallocated = fees.minus(feeWemob).minus(feePartner);
  const taxes = taxRules.map((t) => ({ name: t.name, rate: t.rate, amount: s2(gross.times(t.rate)) }));
  const expensesByCategory: Record<string, Decimal> = {};
  for (const e of site.expenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? D(0)).plus(e.amount);
  const expenses = r2(sum(Object.values(expensesByCategory)));
  const partnerShare = D(split.partner).minus(feePartner);
  const wemobAfterFees = D(split.wemob).minus(feeWemob);
  const taxTotal = sum(taxes.map((t) => t.amount));
  // Informativos (unidade como um todo): não alteram as partes de ninguém.
  const netRevenue = gross.minus(taxTotal).minus(fees);
  return {
    siteId: site.siteId,
    siteName: site.siteName,
    partnerOrganizationId: site.partnerOrganizationId,
    partnerName: site.partnerName,
    contract: c,
    stations: site.stations.map((s) => ({ ...s, chargingRevenue: s2(D(s.chargingRevenue)) })),
    chargingRevenue: s2(chargingRevenue),
    otherRevenue: s2(otherRevenue),
    gross: split.gross,
    taxes,
    taxTotal: s2(taxTotal),
    // Campos do modelo antigo sem efeito aqui: taxa de sistema e royalty não existem na participação.
    platformFee: "0.00",
    netRevenue: s2(netRevenue),
    royalty: "0.00",
    expensesByCategory: Object.fromEntries(Object.entries(expensesByCategory).map(([k, v]) => [k, s2(v)])),
    expenses: s2(expenses),
    operatingResult: s2(netRevenue.minus(expenses)),
    lossCarriedIn: "0.00",
    partnerShareBaseValue: split.gross,
    partnerShare: s2(partnerShare),
    lossCarriedOut: "0.00",
    // Resultado da operadora = participação da WeMob menos as tarifas que lhe cabem (tributos e custos à parte).
    operatorResult: s2(wemobAfterFees),
    partnerSplitReceived: s2(D(site.splitAlreadyTransferred ?? 0)),
    partnerBalance: s2(partnerShare.minus(site.splitAlreadyTransferred ?? 0)),
    gatewayFees: s2(fees),
    shareModel: "REVENUE_SHARE",
    wemobShare: split.wemob,
    partnerGrossShare: split.partner,
    gatewayFeesWemob: s2(feeWemob),
    gatewayFeesPartner: s2(feePartner),
    gatewayFeesUnallocated: s2(unallocated),
  };
}

const TOTAL_KEYS = ["chargingRevenue", "otherRevenue", "gross", "taxTotal", "platformFee", "netRevenue", "royalty", "expenses", "operatingResult", "partnerShare", "operatorResult", "partnerSplitReceived", "partnerBalance", "gatewayFees", "wemobShare", "partnerGrossShare", "gatewayFeesUnallocated"] as const;
export type Totals = Record<(typeof TOTAL_KEYS)[number], string>;

/** Snapshots anteriores à 1.2.0 não têm os campos de split/tarifa: tratados como zero/repasse integral. */
export function totals(lines: Partial<Pick<SiteLine, (typeof TOTAL_KEYS)[number]>>[], extraNetworkExpenses = "0"): Totals & { networkExpenses: string; networkResult: string } {
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, sum(lines.map((l) => l[k] ?? (k === "partnerBalance" ? l.partnerShare ?? 0 : 0))).toFixed(2)])) as Totals;
  return { ...t, networkExpenses: D(extraNetworkExpenses).toFixed(2), networkResult: D(t.operatorResult).minus(extraNetworkExpenses).toFixed(2) };
}

/** Totais por parceiro (somente unidades com contrato). */
export function byPartner(lines: SiteLine[]) {
  const groups = new Map<string, SiteLine[]>();
  for (const l of lines) if (l.partnerOrganizationId) groups.set(l.partnerOrganizationId, [...(groups.get(l.partnerOrganizationId) ?? []), l]);
  return [...groups.entries()].map(([partnerOrganizationId, ls]) => ({ partnerOrganizationId, partnerName: ls[0].partnerName, sites: ls.length, ...totals(ls) }));
}

/** JSON canônico (chaves ordenadas) para o hash do snapshot. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v instanceof Date ? v.toISOString() : v ?? null);
}
