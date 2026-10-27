/**
 * SLA de tickets — regras puras, sem I/O.
 *
 * Tempo de SLA = tempo decorrido no calendário da política (corrido 24×7 ou horário útil
 * em America/Belem, UTC−3 fixo) MENOS os intervalos em pausa (status "aguardando terceiro"
 * ou "aguardando solicitante", sempre com motivo registrado).
 * Feriados não são considerados (limitação documentada).
 */
export interface SlaCalendar {
  businessHoursOnly: boolean;
  workStartHour: number; // 0–23, hora local
  workEndHour: number; // 1–24, hora local (exclusivo)
  workDays: number[]; // 0 = domingo … 6 = sábado
}

export const CALENDAR_24X7: SlaCalendar = { businessHoursOnly: false, workStartHour: 0, workEndHour: 24, workDays: [0, 1, 2, 3, 4, 5, 6] };

const OFFSET_MS = 3 * 3600_000; // UTC−3
const MIN = 60_000;
const DAY = 24 * 3600_000;

/** Milissegundos de SLA entre a e b segundo o calendário. */
export function calendarMs(a: Date, b: Date, cal: SlaCalendar): number {
  const start = a.getTime();
  const end = b.getTime();
  if (end <= start) return 0;
  if (!cal.businessHoursOnly) return end - start;
  let total = 0;
  // Percorre os dias locais que intersectam [a, b).
  let dayStartLocal = Math.floor((start - OFFSET_MS) / DAY) * DAY; // meia-noite local em "tempo local"
  while (dayStartLocal + OFFSET_MS < end) {
    const dayUtc = dayStartLocal + OFFSET_MS;
    const weekday = new Date(dayStartLocal).getUTCDay();
    if (cal.workDays.includes(weekday)) {
      const ws = dayUtc + cal.workStartHour * 3600_000;
      const we = dayUtc + cal.workEndHour * 3600_000;
      const s = Math.max(ws, start);
      const e = Math.min(we, end);
      if (e > s) total += e - s;
    }
    dayStartLocal += DAY;
  }
  return total;
}

export type Interval = { from: Date; to: Date | null };

/** Minutos de SLA consumidos até `at`, descontando pausas. */
export function slaElapsedMinutes(createdAt: Date, at: Date, pauses: Interval[], cal: SlaCalendar): number {
  const gross = calendarMs(createdAt, at, cal);
  const paused = pauses.reduce((acc, p) => {
    const from = p.from < createdAt ? createdAt : p.from;
    const to = !p.to || p.to > at ? at : p.to;
    return acc + calendarMs(from, to, cal);
  }, 0);
  return Math.max(0, (gross - paused) / MIN);
}

/** Pausas a partir dos eventos PAUSE/RESUME em ordem cronológica. */
export function pausesFromEvents(events: { kind: string; createdAt: Date }[]): Interval[] {
  const out: Interval[] = [];
  let open: Date | null = null;
  for (const e of [...events].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    if (e.kind === "PAUSE" && !open) open = e.createdAt;
    if (e.kind === "RESUME" && open) {
      out.push({ from: open, to: e.createdAt });
      open = null;
    }
  }
  if (open) out.push({ from: open, to: null });
  return out;
}

export type SlaState = "OK" | "AT_RISK" | "BREACHED" | "MET" | "NO_SLA";

/** Estado de um prazo: em risco a partir de 80% consumido. */
export function slaState(targetMinutes: number | null | undefined, elapsedMinutes: number, done: boolean): SlaState {
  if (!targetMinutes) return "NO_SLA";
  if (done) return elapsedMinutes <= targetMinutes ? "MET" : "BREACHED";
  if (elapsedMinutes > targetMinutes) return "BREACHED";
  return elapsedMinutes >= 0.8 * targetMinutes ? "AT_RISK" : "OK";
}

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  OK: "No prazo",
  AT_RISK: "Em risco (≥ 80%)",
  BREACHED: "Estourado",
  MET: "Cumprido",
  NO_SLA: "Sem SLA",
};
