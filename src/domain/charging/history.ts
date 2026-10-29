import { z } from "zod";

/**
 * Filtros do histórico de recargas do motorista (regra pura, P23 B4). Vêm da URL; valores inválidos são
 * ignorados. O escopo pelo próprio motorista é aplicado no serviço — os filtros só restringem, nunca ampliam.
 */
export const HISTORY_PERIODS = { "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" } as const;
export const HISTORY_STATES = { andamento: "Em andamento", sem_comunicacao: "Sem comunicação", encerrada: "Encerradas" } as const;
type Period = keyof typeof HISTORY_PERIODS;
type HistoryState = keyof typeof HISTORY_STATES;

export const historyFilterSchema = z.object({
  periodo: z.enum(Object.keys(HISTORY_PERIODS) as [Period, ...Period[]]).optional().catch(undefined),
  estacao: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/).optional().catch(undefined),
  estado: z.enum(Object.keys(HISTORY_STATES) as [HistoryState, ...HistoryState[]]).optional().catch(undefined),
});
export type HistoryFilters = z.infer<typeof historyFilterSchema>;

export function parseHistoryFilters(raw: Record<string, string | string[] | undefined>): HistoryFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]);
  return historyFilterSchema.parse({ periodo: one("periodo") || undefined, estacao: one("estacao") || undefined, estado: one("estado") || undefined });
}

export const hasHistoryFilters = (f: HistoryFilters) => !!(f.periodo || f.estacao || f.estado);

/** Estado da sessão correspondente ao filtro. */
export const HISTORY_STATE_TO_SESSION = { andamento: "ACTIVE", sem_comunicacao: "COMMUNICATION_LOST", encerrada: "COMPLETED" } as const;

/** Início da janela do período (meia-noite não importa: é "últimos N dias" a partir de agora). */
export function periodStart(periodo: Period | undefined, now = new Date()) {
  return periodo ? new Date(now.getTime() - Number(periodo) * 86_400_000) : undefined;
}
