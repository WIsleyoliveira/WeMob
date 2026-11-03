import Decimal from "decimal.js";

/** Vigência de versões de contrato — regra pura. */
export interface VersionWindow {
  id: string;
  version: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Versão vigente em `at`: APROVADA com maior effectiveFrom ≤ at (empate: maior número) e at < effectiveTo. */
export function versionEffectiveAt<T extends VersionWindow>(versions: T[], at: Date): T | null {
  const v = versions
    .filter((x) => x.status === "APPROVED" && x.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version)[0];
  if (!v) return null;
  return v.effectiveTo && at >= v.effectiveTo ? null : v;
}

/** Versões aprovadas que passam a valer dentro de (start, end): indicam troca de condição no meio do período. */
export function versionChangesWithin<T extends VersionWindow>(versions: T[], start: Date, end: Date): T[] {
  return versions.filter((x) => x.status === "APPROVED" && ((x.effectiveFrom > start && x.effectiveFrom < end) || (x.effectiveTo && x.effectiveTo > start && x.effectiveTo < end)));
}

type Rate = { toString(): string };
const percent = (r: Rate) => `${new Decimal(r.toString()).times(100).toDecimalPlaces(2).toString().replace(".", ",")}%`;
const BASE_TEXT = { GROSS_REVENUE: "bruto", NET_REVENUE: "receita líquida", OPERATING_RESULT: "resultado operacional" } as const;
const BEARER_TEXT = { PENDING_DECISION: "tarifas do gateway: a definir (WAPE)", WEMOB: "tarifas do gateway: WeMob", PARTNER: "tarifas do gateway: posto", PROPORTIONAL: "tarifas do gateway: proporcionais" } as const;

/** Resumo legível das condições de uma versão (participação sobre o bruto ou modelo antigo). */
export function describeTerms(v: {
  revenueShareRate: Rate | null;
  gatewayFeeBearer: keyof typeof BEARER_TEXT;
  royaltyRate: Rate;
  royaltyBase: keyof typeof BASE_TEXT;
  platformFeeRate: Rate;
  partnerShareRate: Rate;
  partnerShareBase: keyof typeof BASE_TEXT;
}) {
  if (v.revenueShareRate !== null) {
    const wemob = new Decimal(v.revenueShareRate.toString());
    return `Participação sobre o bruto: WeMob ${percent(wemob)} · posto ${percent(new Decimal(1).minus(wemob))} · ${BEARER_TEXT[v.gatewayFeeBearer]}`;
  }
  return `Modelo antigo: royalty ${percent(v.royaltyRate)} s/ ${BASE_TEXT[v.royaltyBase]} · taxa de sistema ${percent(v.platformFeeRate)} · parceiro ${percent(v.partnerShareRate)} s/ ${BASE_TEXT[v.partnerShareBase]}`;
}
