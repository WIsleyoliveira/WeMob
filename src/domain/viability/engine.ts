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
 * - Custo de gateway à parte só é aceito quando a taxa de sistema NÃO inclui o gateway
 *   (evita dupla contagem).
 * - Partilha: base = resultado operacional mensal; prejuízo rateado no mês ou compensado
 *   antes de novas distribuições, conforme a versão do modelo.
 * - O resultado é uma PROJEÇÃO. Nada aqui representa resultado realizado.
 */
import Decimal from "decimal.js";
import { z } from "zod";
import { commercialTermsSchema, type FeeBase } from "@/domain/commercial/types";

export const ENGINE_VERSION = "viability-2.0.0";
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
    /** Utilização informada como horas equivalentes à potência plena… */
    equivalentHoursPerDay: z.coerce.number().min(0).max(24).optional(),
    /** …ou como ocupação dos conectores (fração do dia) × fator médio de potência entregue. */
    occupancyRate: fraction.optional(),
    averagePowerFactor: z.coerce.number().gt(0).max(1).default(1),
    daysPerMonth: z.coerce.number().gt(0).max(31).default(DEFAULT_DAYS_PER_MONTH),
    kwhPerSession: z.coerce.number().gt(0).max(1000).optional(),
    pricePerKwh: z.coerce.number().gt(0).max(100),
    energyCostPerKwh: nonNeg.max(100),
    chargingEfficiency: z.coerce.number().min(0.5).max(1).default(1),
    commissionRate: fraction.default(0),
    /** Custos de gateway à parte (somente se a taxa de sistema não incluir gateway). */
    gatewayRate: fraction.default(0),
    gatewayFixedPerSession: nonNeg.max(100).default(0),
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
    /** Capital de giro aportado no mês 0 (na proporção do capital) e devolvido no último mês, se marcado. */
    workingCapital: nonNeg.default(0),
    recoverWorkingCapital: z.boolean().default(true),
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
  })
  .refine((v) => (v.equivalentHoursPerDay === undefined) !== (v.occupancyRate === undefined), {
    message: "Informe a utilização por horas equivalentes OU por ocupação (apenas um).",
    path: ["equivalentHoursPerDay"],
  })
  .refine((v) => !v.terms.platformFeeIncludesGateway || (v.gatewayRate === 0 && v.gatewayFixedPerSession === 0), {
    message: "A taxa de sistema deste modelo já inclui o gateway: informar custo de gateway à parte seria dupla contagem.",
    path: ["gatewayRate"],
  })
  .refine((v) => v.gatewayFixedPerSession === 0 || v.kwhPerSession !== undefined, {
    message: "Para tarifa fixa por transação, informe o kWh médio por sessão.",
    path: ["kwhPerSession"],
  });

export type ViabilityInput = z.input<typeof viabilityInputSchema>;
export type ParsedViabilityInput = z.output<typeof viabilityInputSchema>;

export interface MonthRow {
  month: number;
  energySoldKwh: string;
  energyPurchasedKwh: string;
  sessions: string | null;
  capacityCapped: boolean;
  grossRevenue: string;
  taxes: string;
  netRevenue: string;
  paymentFees: string;
  gatewayFees: string;
  revenueAfterPaymentFees: string;
  royalty: string;
  commission: string;
  energyCost: string;
  variableCosts: string;
  fixedCosts: string;
  operatingResult: string;
  lossCarriedForward: string;
  distributableResult: string;
  partnerResult: string;
  operatorResult: string;
  partnerCashFlow: string;
  partnerCumulativeCash: string;
}

export interface YearRow {
  year: number;
  months: number;
  energySoldKwh: string;
  grossRevenue: string;
  netRevenue: string;
  operatingCosts: string;
  ebitda: string;
  partnerCashFlow: string;
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
    utilizationMode: "HOURS" | "OCCUPANCY";
  };
  investment: { total: string; partner: string; operator: string; workingCapitalPartner: string; workingCapitalTotal: string };
  months: MonthRow[];
  years: YearRow[];
  totals: Omit<MonthRow, "month" | "capacityCapped" | "partnerCumulativeCash" | "sessions" | "lossCarriedForward">;
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
    ebitdaHorizon: string;
  };
  /** Limiar de cada variável em que o resultado operacional do mês 1 chega a zero (demais premissas fixas). */
  viabilityThresholds: {
    minPricePerKwh: string | null;
    maxEnergyCostPerKwh: string | null;
    minHoursPerDay: string | null;
    maxFixedMonthly: string | null;
  };
  viabilityFlags: string[];
  sensitivity: SensitivityRow[];
  sensitivityRanking: { driver: SensitivityRow["driver"]; spread: string }[];
  warnings: string[];
}

function feeBaseFactor(base: FeeBase, platformRate: Dec): Dec {
  return base === "GROSS_REVENUE" ? new D(1) : new D(1).minus(platformRate);
}

/** TIR por bisseção sobre fluxos mensais. null quando não há troca de sinal. */
export function irr(cashflows: (Dec | number | string)[]): Dec | null {
  const flows = cashflows.map((c) => new D(c));
  const npvAt = (r: Dec) => flows.reduce((acc, cf, t) => acc.plus(cf.div(new D(1).plus(r).pow(t))), new D(0));
  let lo = new D(-0.99);
  let hi = new D(10);
  let fLo = npvAt(lo);
  const fHi = npvAt(hi);
  if (fLo.isZero()) return lo;
  if (fLo.mul(fHi).gt(0)) return null;
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
  const gatewayRate = new D(input.gatewayRate);
  const taxRate = new D(t.taxRate);
  const royaltyRate = new D(t.royaltyRate);
  const commissionRate = new D(input.commissionRate);
  const partnerResultShare = new D(t.partnerResultShare);
  const efficiency = new D(input.chargingEfficiency);
  const price = new D(input.pricePerKwh);
  const energyUnitCost = new D(input.energyCostPerKwh);
  const days = new D(input.daysPerMonth);
  const gatewayFixed = new D(input.gatewayFixedPerSession);
  const kwhPerSession = input.kwhPerSession ? new D(input.kwhPerSession) : null;

  // ── Capacidade física e utilização
  const installedKw = input.chargers.reduce((acc, c) => acc.plus(new D(c.powerKw).mul(c.count)), new D(0));
  const effectiveKw = input.gridLimitKw ? D.min(installedKw, new D(input.gridLimitKw)) : installedKw;
  if (input.gridLimitKw && installedKw.gt(input.gridLimitKw)) {
    warnings.push(
      `Potência instalada (${installedKw} kW) excede o limite de conexão (${input.gridLimitKw} kW); a projeção usa ${effectiveKw} kW simultâneos.`,
    );
  }
  const maxHours = new D(24).mul(input.availability);
  const utilizationMode = input.occupancyRate !== undefined ? "OCCUPANCY" : "HOURS";
  const hours =
    utilizationMode === "OCCUPANCY"
      ? new D(24).mul(input.occupancyRate!).mul(input.averagePowerFactor)
      : new D(input.equivalentHoursPerDay!);
  if (hours.gt(maxHours)) {
    warnings.push(
      `Horas equivalentes (${hours.toDecimalPlaces(2)}) excedem o máximo permitido pela disponibilidade (${maxHours.toDecimalPlaces(2)} h/dia). A energia foi limitada à capacidade física.`,
    );
  }
  const monthlyCapacity = effectiveKw.mul(maxHours).mul(days);
  if (efficiency.eq(1)) warnings.push("Eficiência de recarga = 100%: perdas elétricas não estão consideradas.");
  if (input.terms.taxRate === 0) warnings.push("Tributos zerados: confirme o regime tributário com a contabilidade.");

  const fixedTotal = Object.values(input.fixedMonthly).reduce((acc, v) => acc.plus(v), new D(0));
  const investmentTotal = money(Object.values(input.investment).reduce((acc, v) => acc.plus(v), new D(0)));
  const partnerInvestment = money(investmentTotal.mul(t.partnerCapitalShare));
  const operatorInvestment = investmentTotal.minus(partnerInvestment);
  const wcTotal = money(new D(input.workingCapital));
  const wcPartner = money(wcTotal.mul(t.partnerCapitalShare));
  if (investmentTotal.isZero()) warnings.push("Investimento não informado: payback e ROI não podem ser calculados.");

  const royaltyFactor = feeBaseFactor(t.royaltyBase, platformRate);
  const taxFactor = feeBaseFactor(t.taxBase, platformRate);

  // ── Projeção mensal
  const rows: MonthRow[] = [];
  const growth = new D(1).plus(input.monthlyGrowthRate);
  const partnerOutlay = partnerInvestment.plus(wcPartner);
  let cumulative = partnerOutlay.neg();
  const partnerFlows: Dec[] = [partnerOutlay.neg()];
  let payback: number | null = partnerOutlay.isZero() ? 0 : null;
  let carried = new D(0); // prejuízo acumulado a compensar (≤ 0)
  let maxCarried = new D(0);

  for (let m = 1; m <= input.horizonMonths; m++) {
    const seasonIdx = (input.startMonth - 1 + m - 1) % 12;
    const season = new D(input.seasonality ? input.seasonality[seasonIdx] : 1);
    const demandFactor = growth.pow(m - 1).mul(season);
    const requested = effectiveKw.mul(hours).mul(days).mul(demandFactor);
    const capped = requested.gt(monthlyCapacity);
    const energySold = (capped ? monthlyCapacity : requested).toDecimalPlaces(3);
    const energyPurchased = energySold.div(efficiency).toDecimalPlaces(3);
    const sessions = kwhPerSession ? energySold.div(kwhPerSession).toDecimalPlaces(1) : null;

    const gross = money(energySold.mul(price));
    const paymentFees = money(gross.mul(platformRate));
    const gatewayFees = money(gross.mul(gatewayRate).plus(sessions ? sessions.mul(gatewayFixed) : 0));
    const taxes = money(gross.mul(taxFactor).mul(taxRate));
    const royalty = money(gross.mul(royaltyFactor).mul(royaltyRate));
    const commission = money(gross.mul(commissionRate));
    const energyCost = money(energyPurchased.mul(energyUnitCost));
    const variable = paymentFees.plus(gatewayFees).plus(taxes).plus(royalty).plus(commission).plus(energyCost);
    const fixed = money(fixedTotal);
    const operating = gross.minus(variable).minus(fixed);

    // Partilha conforme tratamento de prejuízo do contrato.
    let distributable: Dec;
    if (t.lossTreatment === "CARRY_FORWARD") {
      const afterComp = operating.plus(carried);
      distributable = D.max(afterComp, 0);
      carried = D.min(afterComp, 0);
      if (carried.lt(maxCarried)) maxCarried = carried;
    } else {
      distributable = operating;
    }
    const partner = money(distributable.mul(partnerResultShare));
    const operator = distributable.minus(partner);
    const wcBack = m === input.horizonMonths && input.recoverWorkingCapital ? wcPartner : new D(0);
    const partnerCash = partner.plus(wcBack);

    const before = cumulative;
    cumulative = cumulative.plus(partnerCash);
    partnerFlows.push(partnerCash);
    if (payback === null && cumulative.gte(0) && partnerCash.gt(0)) {
      payback = new D(m - 1).plus(before.neg().div(partnerCash)).toDecimalPlaces(1).toNumber();
    }

    rows.push({
      month: m,
      energySoldKwh: energySold.toFixed(3),
      energyPurchasedKwh: energyPurchased.toFixed(3),
      sessions: sessions ? sessions.toFixed(1) : null,
      capacityCapped: capped,
      grossRevenue: gross.toFixed(2),
      taxes: taxes.toFixed(2),
      netRevenue: gross.minus(taxes).toFixed(2),
      paymentFees: paymentFees.toFixed(2),
      gatewayFees: gatewayFees.toFixed(2),
      revenueAfterPaymentFees: gross.minus(paymentFees).minus(gatewayFees).toFixed(2),
      royalty: royalty.toFixed(2),
      commission: commission.toFixed(2),
      energyCost: energyCost.toFixed(2),
      variableCosts: variable.toFixed(2),
      fixedCosts: fixed.toFixed(2),
      operatingResult: operating.toFixed(2),
      lossCarriedForward: carried.toFixed(2),
      distributableResult: distributable.toFixed(2),
      partnerResult: partner.toFixed(2),
      operatorResult: operator.toFixed(2),
      partnerCashFlow: partnerCash.toFixed(2),
      partnerCumulativeCash: cumulative.toFixed(2),
    });
  }
  if (rows.some((r) => r.capacityCapped) && !hours.gt(maxHours)) {
    warnings.push("Em alguns meses a demanda projetada (crescimento/sazonalidade) excedeu a capacidade física e foi limitada.");
  }
  if (t.lossTreatment === "CARRY_FORWARD" && maxCarried.lt(0) && maxCarried.abs().gt(wcTotal)) {
    warnings.push(
      `Prejuízo acumulado chega a ${money(maxCarried.abs()).toFixed(2)} e supera o capital de giro (${wcTotal.toFixed(2)}): o contrato precisa definir quem cobre o déficit de caixa.`,
    );
  }

  const sum = (k: keyof MonthRow, dp = 2) => rows.reduce((acc, r) => acc.plus(r[k] as string), new D(0)).toFixed(dp);
  const totals = {
    energySoldKwh: sum("energySoldKwh", 3),
    energyPurchasedKwh: sum("energyPurchasedKwh", 3),
    grossRevenue: sum("grossRevenue"),
    taxes: sum("taxes"),
    netRevenue: sum("netRevenue"),
    paymentFees: sum("paymentFees"),
    gatewayFees: sum("gatewayFees"),
    revenueAfterPaymentFees: sum("revenueAfterPaymentFees"),
    royalty: sum("royalty"),
    commission: sum("commission"),
    energyCost: sum("energyCost"),
    variableCosts: sum("variableCosts"),
    fixedCosts: sum("fixedCosts"),
    operatingResult: sum("operatingResult"),
    distributableResult: sum("distributableResult"),
    partnerResult: sum("partnerResult"),
    operatorResult: sum("operatorResult"),
    partnerCashFlow: sum("partnerCashFlow"),
  };

  // ── Visão anual (ano 1 = meses 1–12…)
  const years: YearRow[] = [];
  for (let y = 0; y * 12 < rows.length; y++) {
    const slice = rows.slice(y * 12, y * 12 + 12);
    const s = (k: keyof MonthRow) => slice.reduce((a, r) => a.plus(r[k] as string), new D(0));
    const opCosts = s("paymentFees").plus(s("gatewayFees")).plus(s("royalty")).plus(s("commission")).plus(s("energyCost")).plus(s("fixedCosts"));
    years.push({
      year: y + 1,
      months: slice.length,
      energySoldKwh: s("energySoldKwh").toFixed(3),
      grossRevenue: s("grossRevenue").toFixed(2),
      netRevenue: s("netRevenue").toFixed(2),
      operatingCosts: opCosts.toFixed(2),
      ebitda: s("operatingResult").toFixed(2),
      partnerCashFlow: s("partnerCashFlow").toFixed(2),
    });
  }

  // ── KPIs
  const firstYear = rows.slice(0, 12).reduce((acc, r) => acc.plus(r.partnerResult), new D(0));
  const hasInvestment = partnerOutlay.gt(0);
  const roi = hasInvestment ? new D(totals.partnerCashFlow).minus(partnerOutlay).div(partnerOutlay) : null;

  let npv: Dec | null = null;
  if (input.discountRateAnnual === undefined) {
    warnings.push("Taxa de desconto não informada: VPL não calculado.");
  } else {
    const rm = new D(1).plus(input.discountRateAnnual).pow(new D(1).div(12)).minus(1);
    npv = partnerFlows.reduce((acc, cf, i) => acc.plus(cf.div(new D(1).plus(rm).pow(i))), new D(0));
  }
  const irrM = hasInvestment && opts.sensitivity !== false ? irr(partnerFlows) : null;

  // Margem de contribuição por kWh (inclui gateway percentual e fixo por sessão).
  const varRate = platformRate.plus(gatewayRate).plus(commissionRate).plus(taxRate.mul(taxFactor)).plus(royaltyRate.mul(royaltyFactor));
  const fixedPerKwh = kwhPerSession ? gatewayFixed.div(kwhPerSession) : new D(0);
  const contribution = price.mul(new D(1).minus(varRate)).minus(energyUnitCost.div(efficiency)).minus(fixedPerKwh);
  let breakEvenKwh: Dec | null = null;
  let breakEvenHours: Dec | null = null;
  if (contribution.lte(0)) {
    warnings.push("Margem de contribuição por kWh ≤ 0: cada kWh vendido aumenta o prejuízo. Revise preço e custos.");
  } else {
    breakEvenKwh = fixedTotal.div(contribution);
    breakEvenHours = effectiveKw.gt(0) ? breakEvenKwh.div(effectiveKw.mul(days)) : null;
  }
  const grossTotal = new D(totals.grossRevenue);

  // ── Limiares de viabilidade operacional (mês 1, demais premissas fixas)
  const e1 = new D(rows[0].energySoldKwh);
  const oneMinusVar = new D(1).minus(varRate);
  const maxEnergy = e1.gt(0) ? efficiency.mul(price.mul(oneMinusVar).minus(fixedPerKwh).minus(fixedTotal.div(e1))) : null;
  const thresholds = {
    minPricePerKwh:
      e1.gt(0) && oneMinusVar.gt(0)
        ? fixedTotal.div(e1).plus(energyUnitCost.div(efficiency)).plus(fixedPerKwh).div(oneMinusVar).toDecimalPlaces(4).toFixed(4)
        : null,
    maxEnergyCostPerKwh: maxEnergy ? D.max(maxEnergy, 0).toDecimalPlaces(4).toFixed(4) : null,
    minHoursPerDay: breakEvenHours ? breakEvenHours.toDecimalPlaces(2).toFixed(2) : null,
    maxFixedMonthly: e1.gt(0) ? money(D.max(e1.mul(contribution), 0)).toFixed(2) : null,
  };

  const flags: string[] = [];
  if (contribution.lte(0)) flags.push("Margem de contribuição negativa: inviável em qualquer volume.");
  if (new D(rows[0].operatingResult).lt(0)) flags.push("Resultado operacional negativo já no mês 1.");
  if (payback === null && hasInvestment) flags.push(`Investimento não se paga em ${input.horizonMonths} meses.`);
  if (npv && npv.lt(0)) flags.push("VPL negativo à taxa de desconto informada.");

  // ── Sensibilidade (±10% e ±20%, primeiros 12 meses)
  const sensitivity: SensitivityRow[] = [];
  if (opts.sensitivity !== false) {
    const deltas = [-0.2, -0.1, 0.1, 0.2];
    const scaleUtil = (d: number): ViabilityInput =>
      utilizationMode === "OCCUPANCY"
        ? { ...input, occupancyRate: Math.min(1, input.occupancyRate! * (1 + d)) }
        : { ...input, equivalentHoursPerDay: Math.min(24, input.equivalentHoursPerDay! * (1 + d)) };
    const variants: Record<SensitivityRow["driver"], (d: number) => ViabilityInput> = {
      utilization: scaleUtil,
      price: (d) => ({ ...input, pricePerKwh: input.pricePerKwh * (1 + d) }),
      energyCost: (d) => ({ ...input, energyCostPerKwh: input.energyCostPerKwh * (1 + d) }),
      fixedCosts: (d) => ({
        ...input,
        fixedMonthly: Object.fromEntries(Object.entries(input.fixedMonthly).map(([k, v]) => [k, v * (1 + d)])) as ParsedViabilityInput["fixedMonthly"],
      }),
    };
    for (const driver of Object.keys(variants) as SensitivityRow["driver"][]) {
      for (const delta of deltas) {
        const r = runViability(variants[driver](delta), { sensitivity: false });
        const n = Math.min(12, r.months.length);
        const avg = r.months.slice(0, n).reduce((acc, row) => acc.plus(row.partnerResult), new D(0)).div(n);
        sensitivity.push({ driver, delta, partnerAvgMonthlyResult: money(avg).toFixed(2), paybackMonths: r.kpis.partnerPaybackMonths });
      }
    }
  }
  const sensitivityRanking =
    sensitivity.length === 0
      ? []
      : (["utilization", "price", "energyCost", "fixedCosts"] as const)
          .map((driver) => {
            const vals = sensitivity.filter((s) => s.driver === driver && Math.abs(s.delta) === 0.2).map((s) => new D(s.partnerAvgMonthlyResult));
            return { driver, spread: vals[0].minus(vals[1]).abs().toFixed(2) };
          })
          .sort((a, b) => new D(b.spread).cmp(a.spread));

  return {
    engineVersion: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    physical: {
      installedPowerKw: installedKw.toFixed(2),
      effectivePowerKw: effectiveKw.toFixed(2),
      maxHoursPerDay: maxHours.toFixed(2),
      monthlyCapacityKwh: monthlyCapacity.toFixed(3),
      requestedHoursPerDay: hours.toDecimalPlaces(2).toFixed(2),
      utilizationMode,
    },
    investment: {
      total: investmentTotal.toFixed(2),
      partner: partnerInvestment.toFixed(2),
      operator: operatorInvestment.toFixed(2),
      workingCapitalPartner: wcPartner.toFixed(2),
      workingCapitalTotal: wcTotal.toFixed(2),
    },
    months: rows,
    years,
    totals,
    kpis: {
      partnerPaybackMonths: payback,
      partnerRoiHorizon: roi ? roi.toFixed(6) : null,
      partnerFirstYearReturn: money(firstYear).toFixed(2),
      partnerFirstYearReturnRate: hasInvestment ? firstYear.div(partnerOutlay).toFixed(6) : null,
      npv: npv ? money(npv).toFixed(2) : null,
      irrMonthly: irrM ? irrM.toFixed(6) : null,
      irrAnnual: irrM ? new D(1).plus(irrM).pow(12).minus(1).toFixed(6) : null,
      contributionMarginPerKwh: contribution.toDecimalPlaces(4).toFixed(4),
      breakEvenKwhPerMonth: breakEvenKwh ? breakEvenKwh.toDecimalPlaces(3).toFixed(3) : null,
      breakEvenHoursPerDay: breakEvenHours ? breakEvenHours.toDecimalPlaces(2).toFixed(2) : null,
      operatingMarginOnGross: grossTotal.gt(0) ? new D(totals.operatingResult).div(grossTotal).toFixed(6) : null,
      ebitdaHorizon: totals.operatingResult,
    },
    viabilityThresholds: thresholds,
    viabilityFlags: flags,
    sensitivity,
    sensitivityRanking,
    warnings,
  };
}

/**
 * Normaliza premissas salvas por versões anteriores do motor, aplicando os padrões do schema
 * (equivalentes à semântica antiga: gateway incluso, prejuízo rateado no mês, sem capital de giro).
 * Somente para leitura/exibição e para iniciar revisões — o registro salvo não é alterado.
 */
export function normalizeStoredInput(raw: unknown): ParsedViabilityInput | null {
  const r = viabilityInputSchema.safeParse(raw);
  return r.success ? r.data : null;
}
