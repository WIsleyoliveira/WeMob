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
 * Cada linha é arredondada a 2 casas (ROUND_HALF_UP) e os totais somam as linhas arredondadas.
 * Resultado gerencial: não substitui escrituração contábil nem apuração fiscal.
 */
import Decimal from "decimal.js";

/**
 * 1.1.0: receita de recarga lançada manualmente passa a compor "receita de recarga" (antes: "outras receitas").
 * 1.2.0: split liquidado no gateway é descontado do repasse (saldo do repasse) e tarifas reais do gateway são exibidas.
 */
export const SETTLEMENT_ENGINE_VERSION = "settlement-1.2.0";

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
}

const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const s2 = (v: Decimal) => r2(v).toFixed(2);
const sum = (xs: Decimal.Value[]) => xs.reduce<Decimal>((a, x) => a.plus(x), D(0));

export function computeSiteLine(site: SiteInput, taxRules: { name: string; rate: string }[]): SiteLine {
  const c = site.contract;
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

const TOTAL_KEYS = ["chargingRevenue", "otherRevenue", "gross", "taxTotal", "platformFee", "netRevenue", "royalty", "expenses", "operatingResult", "partnerShare", "operatorResult", "partnerSplitReceived", "partnerBalance", "gatewayFees"] as const;
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
