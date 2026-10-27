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
