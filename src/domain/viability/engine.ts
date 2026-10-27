/**
 * Motor de viabilidade econômica de eletropostos.
 *
 * Regras:
 * - Todos os cálculos usam Decimal (nunca ponto flutuante binário).
 * - Linhas monetárias mensais são arredondadas a centavos (ROUND_HALF_UP) e os totais
 *   são a soma das linhas arredondadas — o que aparece na tabela fecha com o total.
 * - Potência (kW) × horas equivalentes (h) × dias = energia (kWh). A energia é limitada pela
 *   capacidade física: potência efetiva × 24 h × disponibilidade × dias.
 * - Cada taxa incide sobre a base configurada na versão do modelo comercial; nenhuma taxa
 *   incide sobre outra taxa, salvo quando a base é explicitamente "bruto após taxa de sistema".
 * - O resultado é uma PROJEÇÃO. Nada aqui representa resultado realizado.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { commercialTermsSchema, type FeeBase } from "@/domain/commercial/types";

export const ENGINE_VERSION = "viability-1.0.0";
export const DEFAULT_DAYS_PER_MONTH = 365 / 12;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof D>;

const money = (v: Dec) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const nonNeg = z.coerce.number().min(0);
const fraction = z.coerce.number().min(0).max(1);

export const viabilityInputSchema = z
  .object({
    chargers: z
      .array(
        z.object({
          label: z.string().max(80).optional(),
          count: z.coerce.number().int().min(1).max(500),
          powerKw: z.coerce.number().gt(0).max(1000),
        }),
      )
      .min(1, "Informe ao menos um carregador.")
      .max(20, "Máximo de 20 tipos de carregador por simulação."),
    gridLimitKw: z.coerce.number().gt(0).optional(),
    availability: z.coerce.number().gt(0).max(1),
    equivalentHoursPerDay: z.coerce.number().min(0).max(24),
    daysPerMonth: z.coerce.number().gt(0).max(31).default(DEFAULT_DAYS_PER_MONTH),
    pricePerKwh: z.coerce.number().gt(0).max(100),
    energyCostPerKwh: nonNeg.max(100),
    chargingEfficiency: z.coerce.number().min(0.5).max(1).default(1),
    commissionRate: fraction.default(0),
    fixedMonthly: z
      .object({
        demandCharge: nonNeg.default(0),
        connectivity: nonNeg.default(0),
        software: nonNeg.default(0),
        rent: nonNeg.default(0),
        maintenance: nonNeg.default(0),
        other: nonNeg.default(0),
      })
      .default({}),
    investment: z
      .object({
        projectAndImplementation: nonNeg.default(0),
        equipment: nonNeg.default(0),
        works: nonNeg.default(0),
        other: nonNeg.default(0),
      })
      .default({}),
    monthlyGrowthRate: z.coerce.number().min(-0.5).max(0.5).default(0),
    seasonality: z.array(z.coerce.number().min(0).max(3)).length(12).optional(),
    startMonth: z.coerce.number().int().min(1).max(12).default(1),
    horizonMonths: z.coerce.number().int().min(1).max(240),
    discountRateAnnual: z.coerce.number().min(0).max(1).optional(),
    terms: commercialTermsSchema,
  })
  .refine((v) => v.terms.platformFeeBase === "GROSS_REVENUE", {
    message: "A taxa de sistema/gateway deve incidir sobre o faturamento bruto.",
    path: ["terms", "platformFeeBase"],
  });

export type ViabilityInput = z.input<typeof viabilityInputSchema>;
export type ParsedViabilityInput = z.output<typeof viabilityInputSchema>;

export interface MonthRow {
  month: number;
  energySoldKwh: string;
  energyPurchasedKwh: string;
  capacityCapped: boolean;
  grossRevenue: string;
  paymentFees: string;
  revenueAfterPaymentFees: string;
  taxes: string;
  royalty: string;
  commission: string;
  energyCost: string;
  variableCosts: string;
  fixedCosts: string;
  operatingResult: string;
  partnerResult: string;
  operatorResult: string;
  partnerCumulativeCash: string;
}

export interface SensitivityRow {
  driver: "utilization" | "price" | "energyCost" | "fixedCosts";
  delta: number;
  partnerAvgMonthlyResult: string;
  paybackMonths: number | null;
}

export interface ViabilityResult {
  engineVersion: string;
  computedAt: string;
  physical: {
    installedPowerKw: string;
    effectivePowerKw: string;
    maxHoursPerDay: string;
    monthlyCapacityKwh: string;
    requestedHoursPerDay: string;
  };
  investment: { total: string; partner: string; operator: string };
  months: MonthRow[];
  totals: Omit<MonthRow, "month" | "capacityCapped" | "partnerCumulativeCash">;
  kpis: {
    partnerPaybackMonths: number | null;
    partnerRoiHorizon: string | null;
    partnerFirstYearReturn: string | null;
    partnerFirstYearReturnRate: string | null;
    npv: string | null;
    irrMonthly: string | null;
    irrAnnual: string | null;
    contributionMarginPerKwh: string;
    breakEvenKwhPerMonth: string | null;
    breakEvenHoursPerDay: string | null;
    operatingMarginOnGross: string | null;
  };
  sensitivity: SensitivityRow[];
  warnings: string[];
}

function feeBaseFactor(base: FeeBase, platformRate: Dec): Dec {
  return base === "GROSS_REVENUE" ? new D(1) : new D(1).minus(platformRate);
}

function irr(cashflows: Dec[]): Dec | null {
  const npvAt = (r: Dec) =>
    cashflows.reduce((acc, cf, t) => acc.plus(cf.div(new D(1).plus(r).pow(t))), new D(0));
  let lo = new D(-0.99);
  let hi = new D(10);
  let fLo = npvAt(lo);
  const fHi = npvAt(hi);
  if (fLo.isZero()) return lo;
  if (fLo.mul(fHi).gt(0)) return null; // sem troca de sinal: TIR indefinida
  for (let i = 0; i < 200; i++) {
    const mid = lo.plus(hi).div(2);
    const fMid = npvAt(mid);
    if (fMid.abs().lt("1e-9") || hi.minus(lo).lt("1e-12")) return mid;
    if (fLo.mul(fMid).lt(0)) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return lo.plus(hi).div(2);
}

export function runViability(raw: ViabilityInput, opts: { sensitivity?: boolean } = {}): ViabilityResult {
  const input = viabilityInputSchema.parse(raw);
  const t = input.terms;
  const warnings: string[] = [];

  const platformRate = new D(t.platformFeeRate);
  const taxRate = new D(t.taxRate);
  const royaltyRate = new D(t.royaltyRate);
  const commissionRate = new D(input.commissionRate);
  const partnerResultShare = new D(t.partnerResultShare);
  const efficiency = new D(input.chargingEfficiency);
  const price = new D(input.pricePerKwh);
  const energyUnitCost = new D(input.energyCostPerKwh);
  const days = new D(input.daysPerMonth);

  // ── Capacidade física
  const installedKw = input.chargers.reduce((acc, c) => acc.plus(new D(c.powerKw).mul(c.count)), new D(0));
  const effectiveKw = input.gridLimitKw ? D.min(installedKw, new D(input.gridLimitKw)) : installedKw;
  if (input.gridLimitKw && installedKw.gt(input.gridLimitKw)) {
    warnings.push(
      `Potência instalada (${installedKw} kW) excede o limite de conexão (${input.gridLimitKw} kW); a projeção usa ${effectiveKw} kW simultâneos.`,
    );
  }
  const maxHours = new D(24).mul(input.availability);
  const hours = new D(input.equivalentHoursPerDay);
  if (hours.gt(maxHours)) {
    warnings.push(
      `Horas equivalentes (${hours}) excedem o máximo permitido pela disponibilidade (${maxHours.toDecimalPlaces(2)} h/dia). A energia foi limitada à capacidade física.`,
    );
  }
  const monthlyCapacity = effectiveKw.mul(maxHours).mul(days);
  if (efficiency.eq(1)) warnings.push("Eficiência de recarga = 100%: perdas elétricas não estão consideradas.");
  if (input.terms.taxRate === 0) warnings.push("Tributos zerados: confirme o regime tributário com a contabilidade.");

  const fixedTotal = Object.values(input.fixedMonthly).reduce((acc, v) => acc.plus(v), new D(0));
  const investmentTotal = money(Object.values(input.investment).reduce((acc, v) => acc.plus(v), new D(0)));
  const partnerInvestment = money(investmentTotal.mul(t.partnerCapitalShare));
  const operatorInvestment = investmentTotal.minus(partnerInvestment);
  if (investmentTotal.isZero()) warnings.push("Investimento não informado: payback e ROI não podem ser calculados.");

  const royaltyFactor = feeBaseFactor(t.royaltyBase, platformRate);
  const taxFactor = feeBaseFactor(t.taxBase, platformRate);

  // ── Projeção mensal
  const rows: MonthRow[] = [];
  const growth = new D(1).plus(input.monthlyGrowthRate);
  let cumulative = partnerInvestment.neg();
  const partnerFlows: Dec[] = [partnerInvestment.neg()];
  let payback: number | null = partnerInvestment.isZero() ? 0 : null;

  for (let m = 1; m <= input.horizonMonths; m++) {
    const seasonIdx = (input.startMonth - 1 + m - 1) % 12;
    const season = new D(input.seasonality ? input.seasonality[seasonIdx] : 1);
    const demandFactor = growth.pow(m - 1).mul(season);
    const requested = effectiveKw.mul(hours).mul(days).mul(demandFactor);
    const capped = requested.gt(monthlyCapacity);
    const energySold = (capped ? monthlyCapacity : requested).toDecimalPlaces(3);
    const energyPurchased = energySold.div(efficiency).toDecimalPlaces(3);

    const gross = money(energySold.mul(price));
    const paymentFees = money(gross.mul(platformRate));
    const taxes = money(gross.mul(taxFactor).mul(taxRate));
    const royalty = money(gross.mul(royaltyFactor).mul(royaltyRate));
    const commission = money(gross.mul(commissionRate));
    const energyCost = money(energyPurchased.mul(energyUnitCost));
    const variable = paymentFees.plus(taxes).plus(royalty).plus(commission).plus(energyCost);
    const fixed = money(fixedTotal);
    const operating = gross.minus(variable).minus(fixed);
    const partner = money(operating.mul(partnerResultShare));
    const operator = operating.minus(partner);

    const before = cumulative;
    cumulative = cumulative.plus(partner);
    partnerFlows.push(partner);
    if (payback === null && cumulative.gte(0) && partner.gt(0)) {
      payback = new D(m - 1).plus(before.neg().div(partner)).toDecimalPlaces(1).toNumber();
    }

    rows.push({
      month: m,
      energySoldKwh: energySold.toFixed(3),
      energyPurchasedKwh: energyPurchased.toFixed(3),
      capacityCapped: capped,
      grossRevenue: gross.toFixed(2),
      paymentFees: paymentFees.toFixed(2),
      revenueAfterPaymentFees: gross.minus(paymentFees).toFixed(2),
      taxes: taxes.toFixed(2),
      royalty: royalty.toFixed(2),
      commission: commission.toFixed(2),
      energyCost: energyCost.toFixed(2),
      variableCosts: variable.toFixed(2),
      fixedCosts: fixed.toFixed(2),
      operatingResult: operating.toFixed(2),
      partnerResult: partner.toFixed(2),
      operatorResult: operator.toFixed(2),
      partnerCumulativeCash: cumulative.toFixed(2),
    });
  }
  if (rows.some((r) => r.capacityCapped) && !hours.gt(maxHours)) {
    warnings.push("Em alguns meses a demanda projetada (crescimento/sazonalidade) excedeu a capacidade física e foi limitada.");
  }

  const sum = (k: keyof MonthRow, dp = 2) =>
    rows.reduce((acc, r) => acc.plus(r[k] as string), new D(0)).toFixed(dp);
  const totals = {
    energySoldKwh: sum("energySoldKwh", 3),
    energyPurchasedKwh: sum("energyPurchasedKwh", 3),
    grossRevenue: sum("grossRevenue"),
    paymentFees: sum("paymentFees"),
    revenueAfterPaymentFees: sum("revenueAfterPaymentFees"),
    taxes: sum("taxes"),
    royalty: sum("royalty"),
    commission: sum("commission"),
    energyCost: sum("energyCost"),
    variableCosts: sum("variableCosts"),
    fixedCosts: sum("fixedCosts"),
    operatingResult: sum("operatingResult"),
    partnerResult: sum("partnerResult"),
    operatorResult: sum("operatorResult"),
  };

  // ── KPIs
  const firstYear = rows.slice(0, 12).reduce((acc, r) => acc.plus(r.partnerResult), new D(0));
  const hasInvestment = partnerInvestment.gt(0);
  const roi = hasInvestment ? new D(totals.partnerResult).minus(partnerInvestment).div(partnerInvestment) : null;

  let npv: Dec | null = null;
  if (input.discountRateAnnual === undefined) {
    warnings.push("Taxa de desconto não informada: VPL não calculado.");
  } else {
    const rm = new D(1).plus(input.discountRateAnnual).pow(new D(1).div(12)).minus(1);
    npv = partnerFlows.reduce((acc, cf, i) => acc.plus(cf.div(new D(1).plus(rm).pow(i))), new D(0));
  }
  const irrM = hasInvestment && opts.sensitivity !== false ? irr(partnerFlows) : null;

  const contribution = price
    .mul(new D(1).minus(platformRate).minus(commissionRate).minus(taxRate.mul(taxFactor)).minus(royaltyRate.mul(royaltyFactor)))
    .minus(energyUnitCost.div(efficiency));
  let breakEvenKwh: Dec | null = null;
  let breakEvenHours: Dec | null = null;
  if (contribution.lte(0)) {
    warnings.push("Margem de contribuição por kWh ≤ 0: cada kWh vendido aumenta o prejuízo. Revise preço e custos.");
  } else {
    breakEvenKwh = fixedTotal.div(contribution);
    breakEvenHours = effectiveKw.gt(0) ? breakEvenKwh.div(effectiveKw.mul(days)) : null;
  }
  const grossTotal = new D(totals.grossRevenue);

  // ── Sensibilidade (±10% e ±20% em cada direcionador, primeiros 12 meses)
  const sensitivity: SensitivityRow[] = [];
  if (opts.sensitivity !== false) {
    const deltas = [-0.2, -0.1, 0.1, 0.2];
    const variants: Record<SensitivityRow["driver"], (d: number) => ViabilityInput> = {
      utilization: (d) => ({ ...input, equivalentHoursPerDay: Math.min(24, input.equivalentHoursPerDay * (1 + d)) }),
      price: (d) => ({ ...input, pricePerKwh: input.pricePerKwh * (1 + d) }),
      energyCost: (d) => ({ ...input, energyCostPerKwh: input.energyCostPerKwh * (1 + d) }),
      fixedCosts: (d) => ({
        ...input,
        fixedMonthly: Object.fromEntries(
          Object.entries(input.fixedMonthly).map(([k, v]) => [k, v * (1 + d)]),
        ) as ParsedViabilityInput["fixedMonthly"],
      }),
    };
    for (const driver of Object.keys(variants) as SensitivityRow["driver"][]) {
      for (const delta of deltas) {
        const r = runViability(variants[driver](delta), { sensitivity: false });
        const n = Math.min(12, r.months.length);
        const avg = r.months.slice(0, n).reduce((acc, row) => acc.plus(row.partnerResult), new D(0)).div(n);
        sensitivity.push({
          driver,
          delta,
          partnerAvgMonthlyResult: money(avg).toFixed(2),
          paybackMonths: r.kpis.partnerPaybackMonths,
        });
      }
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    physical: {
      installedPowerKw: installedKw.toFixed(2),
      effectivePowerKw: effectiveKw.toFixed(2),
      maxHoursPerDay: maxHours.toFixed(2),
      monthlyCapacityKwh: monthlyCapacity.toFixed(3),
      requestedHoursPerDay: hours.toFixed(2),
    },
    investment: {
      total: investmentTotal.toFixed(2),
      partner: partnerInvestment.toFixed(2),
      operator: operatorInvestment.toFixed(2),
    },
    months: rows,
    totals,
    kpis: {
      partnerPaybackMonths: payback,
      partnerRoiHorizon: roi ? roi.toFixed(6) : null,
      partnerFirstYearReturn: money(firstYear).toFixed(2),
      partnerFirstYearReturnRate: hasInvestment ? firstYear.div(partnerInvestment).toFixed(6) : null,
      npv: npv ? money(npv).toFixed(2) : null,
      irrMonthly: irrM ? irrM.toFixed(6) : null,
      irrAnnual: irrM ? new D(1).plus(irrM).pow(12).minus(1).toFixed(6) : null,
      contributionMarginPerKwh: contribution.toDecimalPlaces(4).toFixed(4),
      breakEvenKwhPerMonth: breakEvenKwh ? breakEvenKwh.toDecimalPlaces(3).toFixed(3) : null,
      breakEvenHoursPerDay: breakEvenHours ? breakEvenHours.toDecimalPlaces(2).toFixed(2) : null,
      operatingMarginOnGross: grossTotal.gt(0) ? new D(totals.operatingResult).div(grossTotal).toFixed(6) : null,
    },
    sensitivity,
    warnings,
  };
}
