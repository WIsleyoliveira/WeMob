/**
 * Manutenção preventiva — regra pura de vencimento.
 * Planos por uso (kWh/sessões) só vencem com telemetria CONFIÁVEL: estação de produção, com
 * comunicação já estabelecida e sem sessões com comunicação perdida no intervalo apurado.
 * Sem telemetria confiável o plano não gera OS e a tela explica o motivo.
 */
export type Trigger = "TIME" | "ENERGY_KWH" | "SESSIONS";

export interface PlanInput {
  trigger: Trigger;
  intervalDays: number | null;
  intervalKwh: number | null;
  intervalSessions: number | null;
}

export interface UsageSince {
  since: Date;
  kwh: number;
  sessions: number;
  reliable: boolean;
  unreliableReason?: string;
}

export type PlanDue = { due: boolean; reason: string; progress: number | null };

export function planDue(plan: PlanInput, usage: UsageSince, now = new Date()): PlanDue {
  if (plan.trigger === "TIME") {
    const days = (now.getTime() - usage.since.getTime()) / 86400_000;
    const target = plan.intervalDays ?? 0;
    if (target <= 0) return { due: false, reason: "Intervalo em dias não configurado.", progress: null };
    return { due: days >= target, reason: `${Math.floor(days)} de ${target} dias desde a última execução.`, progress: Math.min(1, days / target) };
  }
  if (!usage.reliable) return { due: false, reason: `Sem telemetria confiável: ${usage.unreliableReason ?? "dados insuficientes"}.`, progress: null };
  if (plan.trigger === "ENERGY_KWH") {
    const target = plan.intervalKwh ?? 0;
    if (target <= 0) return { due: false, reason: "Intervalo em kWh não configurado.", progress: null };
    return { due: usage.kwh >= target, reason: `${usage.kwh.toFixed(0)} de ${target} kWh desde a última execução.`, progress: Math.min(1, usage.kwh / target) };
  }
  const target = plan.intervalSessions ?? 0;
  if (target <= 0) return { due: false, reason: "Intervalo em sessões não configurado.", progress: null };
  return { due: usage.sessions >= target, reason: `${usage.sessions} de ${target} sessões desde a última execução.`, progress: Math.min(1, usage.sessions / target) };
}
