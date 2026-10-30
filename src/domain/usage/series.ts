import Decimal from "decimal.js";

/**
 * Séries de uso para gráficos e indicadores (regra pura). Agrupa sessões por dia, semana ou mês no fuso de
 * São Paulo e preenche os períodos sem sessão com zero (o gráfico mostra o período inteiro, não só onde há
 * dados). Nenhum valor é estimado: kWh vem do medidor; dinheiro só o confirmado pelo gateway.
 */

export const USAGE_TZ = "America/Sao_Paulo";
export type Granularity = "day" | "week" | "month";

export type UsageSession = {
  startedAt: Date;
  stoppedAt: Date | null;
  energyWh: number;
  /** Valor confirmado pelo gateway para a sessão (capturado − estornado). null = sem pagamento confirmado. */
  paidConfirmed: Decimal.Value | null;
};

export type UsagePoint = { key: string; label: string; sessions: number; kwh: number; paid: string; minutes: number };

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: USAGE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Data local (AAAA-MM-DD) em São Paulo. */
export function localDay(d: Date) {
  return fmtDay.format(d);
}

function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Segunda-feira da semana (ISO) do dia local. */
function weekStart(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

export function bucketKey(d: Date, g: Granularity) {
  const day = localDay(d);
  return g === "day" ? day : g === "week" ? weekStart(day) : day.slice(0, 7);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function bucketLabel(key: string, g: Granularity) {
  if (g === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
  const [, m, d] = key.split("-");
  return g === "week" ? `sem. ${d}/${m}` : `${d}/${m}`;
}

/** Granularidade adequada ao tamanho do período (evita séries enormes no gráfico). */
export function granularityFor(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  return days <= 45 ? "day" : days <= 200 ? "week" : "month";
}

/** Todas as chaves do período, em ordem. */
export function bucketKeys(from: Date, to: Date, g: Granularity) {
  const keys: string[] = [];
  let day = localDay(from);
  const last = localDay(to);
  while (day <= last) {
    const k = g === "day" ? day : g === "week" ? weekStart(day) : day.slice(0, 7);
    if (keys[keys.length - 1] !== k) keys.push(k);
    day = addDays(day, 1);
  }
  return keys;
}

export function usageSeries(sessions: UsageSession[], from: Date, to: Date, g: Granularity = granularityFor(from, to)): UsagePoint[] {
  const acc = new Map(bucketKeys(from, to, g).map((k) => [k, { sessions: 0, wh: 0, paid: new Decimal(0), ms: 0 }]));
  for (const s of sessions) {
    const b = acc.get(bucketKey(s.startedAt, g));
    if (!b) continue; // fora do período
    b.sessions += 1;
    b.wh += Math.max(0, s.energyWh);
    if (s.paidConfirmed !== null) b.paid = b.paid.plus(s.paidConfirmed);
    if (s.stoppedAt) b.ms += Math.max(0, s.stoppedAt.getTime() - s.startedAt.getTime());
  }
  return [...acc.entries()].map(([key, b]) => ({ key, label: bucketLabel(key, g), sessions: b.sessions, kwh: Math.round(b.wh) / 1000, paid: b.paid.toFixed(2), minutes: Math.round(b.ms / 60_000) }));
}

/** Totais do período (sessões concluídas). Médias só com pelo menos uma sessão. */
export function usageTotals(sessions: UsageSession[]) {
  const kwh = sessions.reduce((a, s) => a + Math.max(0, s.energyWh), 0) / 1000;
  const paid = sessions.reduce((a, s) => (s.paidConfirmed === null ? a : a.plus(s.paidConfirmed)), new Decimal(0));
  const minutes = sessions.reduce((a, s) => a + (s.stoppedAt ? Math.max(0, s.stoppedAt.getTime() - s.startedAt.getTime()) : 0), 0) / 60_000;
  const n = sessions.length;
  return {
    sessions: n,
    kwh: Math.round(kwh * 1000) / 1000,
    paid: paid.toFixed(2),
    minutes: Math.round(minutes),
    avgKwh: n ? Math.round((kwh / n) * 1000) / 1000 : null,
    avgMinutes: n ? Math.round(minutes / n) : null,
    unconfirmedPayments: sessions.filter((s) => s.paidConfirmed === null).length,
  };
}

/** Períodos oferecidos nos filtros (sempre explícitos na tela). */
export const USAGE_PERIODS = { mes: "Mês atual", "30": "Últimos 30 dias", "90": "Últimos 90 dias", "365": "Últimos 12 meses" } as const;
export type UsagePeriod = keyof typeof USAGE_PERIODS;

export function periodRange(p: UsagePeriod, now = new Date()) {
  if (p === "mes") {
    const day = localDay(now);
    // meia-noite local do dia 1 (São Paulo = UTC−3, sem horário de verão desde 2019)
    return { from: new Date(`${day.slice(0, 7)}-01T00:00:00-03:00`), to: now };
  }
  return { from: new Date(now.getTime() - Number(p) * 86_400_000), to: now };
}

export const parseUsagePeriod = (raw: string | string[] | undefined): UsagePeriod => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v in USAGE_PERIODS ? (v as UsagePeriod) : "30";
};
