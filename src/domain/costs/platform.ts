/**
 * Custos operacionais mensais da PLATAFORMA WeMob (regra pura). É orçamento de DESPESA da WeMob — separado da receita
 * de participação de 30% e do fechamento dos postos: nada daqui entra em repasse, demonstrativo ou fechamento.
 *
 * Por item:  custo com câmbio = base × (1 + exposição cambial × alta cambial de stress)
 *            reserva operacional = custo com câmbio × taxa de reserva
 *            custo prudencial = custo com câmbio + reserva
 * Por posto: custo incremental + reserva incremental (não inclui energia, manutenção do carregador, hardware,
 *            aluguel de ponto nem tarifas por transação).
 * Total mensal = Σ prudencial dos itens + postos × (incremental + reserva por posto).
 * Cada valor é arredondado a 2 casas (meio para cima) por linha; totais somam as linhas arredondadas.
 * São PREMISSAS DE PLANEJAMENTO, não cotações.
 */
import Decimal from "decimal.js";

export const COST_CATEGORIES = ["INFRASTRUCTURE", "SERVICES", "OPERATIONS", "OTHER"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = { INFRASTRUCTURE: "Infraestrutura", SERVICES: "Serviços", OPERATIONS: "Operação", OTHER: "Outros" };

export interface CostItemInput {
  key: string;
  name: string;
  category: CostCategory;
  /** R$/mês sem câmbio de stress. */
  baseMonthly: Decimal.Value;
  /** Fração do custo exposta ao dólar (0 = só real, 1 = 100% em dólar). */
  fxExposure: Decimal.Value;
}

export interface CostAssumptions {
  /** Alta cambial de stress (0.4 = +40% no dólar). */
  fxStressRate: Decimal.Value;
  /** Reserva operacional sobre o custo ajustado pelo câmbio (0.6 = 60%). */
  reserveRate: Decimal.Value;
  perStationCost: Decimal.Value;
  perStationReserve: Decimal.Value;
}

const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const s2 = (v: Decimal) => r2(v).toFixed(2);
const sum = (xs: Decimal.Value[]) => xs.reduce<Decimal>((a, x) => a.plus(x), new Decimal(0));

export function costLine(item: CostItemInput, a: CostAssumptions) {
  const base = r2(new Decimal(item.baseMonthly));
  const exposure = new Decimal(item.fxExposure);
  const withFx = r2(base.times(new Decimal(1).plus(exposure.times(a.fxStressRate))));
  const reserve = r2(withFx.times(a.reserveRate));
  return {
    key: item.key,
    name: item.name,
    category: item.category,
    fxExposure: exposure.toString(),
    base: base.toFixed(2),
    /** Parcela da base exposta ao dólar (antes do stress). */
    dollarExposed: s2(base.times(exposure)),
    withFx: withFx.toFixed(2),
    reserve: reserve.toFixed(2),
    prudential: withFx.plus(reserve).toFixed(2),
  };
}

export type CostLine = ReturnType<typeof costLine>;

export function computePlatformCosts(items: CostItemInput[], a: CostAssumptions, stations: number) {
  if (!Number.isInteger(stations) || stations < 0) throw new Error("Número de postos inválido.");
  const lines = items.map((i) => costLine(i, a));
  const perStationUnit = r2(new Decimal(a.perStationCost).plus(a.perStationReserve));
  const perStation = perStationUnit.times(stations);
  const totals = {
    base: sum(lines.map((l) => l.base)).toFixed(2),
    dollarExposed: sum(lines.map((l) => l.dollarExposed)).toFixed(2),
    withFx: sum(lines.map((l) => l.withFx)).toFixed(2),
    reserve: sum(lines.map((l) => l.reserve)).toFixed(2),
    prudential: sum(lines.map((l) => l.prudential)).toFixed(2),
  };
  const byCategory = COST_CATEGORIES.map((c) => ({ category: c, prudential: sum(lines.filter((l) => l.category === c).map((l) => l.prudential)).toFixed(2) })).filter((x) => x.prudential !== "0.00");
  return {
    lines,
    totals,
    byCategory,
    stations,
    perStationUnit: perStationUnit.toFixed(2),
    /** Fixo = plataforma (não depende do número de postos); variável = custo incremental dos postos. */
    fixedMonthly: totals.prudential,
    variableMonthly: perStation.toFixed(2),
    totalMonthly: new Decimal(totals.prudential).plus(perStation).toFixed(2),
  };
}

/** Cenários por número de postos (mesmas premissas). */
export function costScenarios(items: CostItemInput[], a: CostAssumptions, scenarios: { name: string; stations: number }[]) {
  return scenarios.map((s) => {
    const r = computePlatformCosts(items, a, s.stations);
    return { name: s.name, stations: s.stations, base: r.totals.base, prudential: r.totals.prudential, stationsCost: r.variableMonthly, totalMonthly: r.totalMonthly };
  });
}

/** Sensibilidade ao câmbio: total prudencial dos itens para cada alta do dólar (mesma reserva). */
export function fxSensitivity(items: CostItemInput[], a: CostAssumptions, shocks: Decimal.Value[]) {
  return shocks.map((fx) => ({ fxStressRate: new Decimal(fx).toString(), prudential: computePlatformCosts(items, { ...a, fxStressRate: fx }, 0).totals.prudential }));
}

export type BudgetState = "WITHIN" | "OVER" | "NO_ACTUAL";

/** Realizado × orçado do mês: alerta quando o realizado passa do orçado × (1 + tolerância). */
export function budgetCheck(budget: Decimal.Value, actual: Decimal.Value | null, tolerance: Decimal.Value) {
  if (actual === null) return { state: "NO_ACTUAL" as BudgetState, variance: null, variancePct: null };
  const b = new Decimal(budget);
  const v = r2(new Decimal(actual).minus(b));
  const pct = b.isZero() ? null : v.div(b).toDecimalPlaces(4).toString();
  const state: BudgetState = new Decimal(actual).gt(b.times(new Decimal(1).plus(tolerance))) ? "OVER" : "WITHIN";
  return { state, variance: v.toFixed(2), variancePct: pct };
}
