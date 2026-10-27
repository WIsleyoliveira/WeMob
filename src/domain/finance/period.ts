/**
 * Períodos de competência mensais ("AAAA-MM") no fuso da operação (America/Belem, UTC−3 fixo,
 * sem horário de verão). Sem I/O.
 */
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const OFFSET = "-03:00";

export function assertPeriod(p: string) {
  if (!PERIOD_RE.test(p)) throw new Error(`Período inválido: ${p} (use AAAA-MM).`);
  return p;
}

/** Início (inclusivo) e fim (exclusivo) do mês de competência. */
export function periodRange(p: string): { start: Date; end: Date } {
  assertPeriod(p);
  const [y, m] = p.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: new Date(`${p}-01T00:00:00${OFFSET}`), end: new Date(`${next}-01T00:00:00${OFFSET}`) };
}

export function periodOf(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousPeriod(p: string): string {
  const [y, m] = assertPeriod(p).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Janela [from, to) cobre o período inteiro? (to nulo = sem término) */
export function coversWholePeriod(w: { from: Date; to: Date | null }, p: string) {
  const { start, end } = periodRange(p);
  return w.from <= start && (!w.to || w.to >= end);
}

/** Janela [from, to) tem interseção com o período? */
export function overlapsPeriod(w: { from: Date; to: Date | null }, p: string) {
  const { start, end } = periodRange(p);
  return w.from < end && (!w.to || w.to > start);
}
