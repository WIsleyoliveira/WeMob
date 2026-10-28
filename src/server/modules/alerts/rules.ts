import { z } from "zod";
import type { AlertKind, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  STATION_OFFLINE: "Carregador sem comunicação",
  REPEATED_FAULTS: "Falhas repetidas no conector",
  AVAILABILITY_DROP: "Queda de disponibilidade",
  SESSION_INTERRUPTED: "Sessão interrompida",
  PAYMENT_DIVERGENCE: "Divergência de pagamento",
};

/** Parâmetros por tipo de regra, com a explicação exibida na tela. */
export const PARAM_SCHEMAS = {
  STATION_OFFLINE: z.object({ minutes: z.coerce.number().int().min(1).max(1440).default(10) }),
  REPEATED_FAULTS: z.object({ count: z.coerce.number().int().min(2).max(100).default(3), windowMinutes: z.coerce.number().int().min(5).max(10080).default(60) }),
  AVAILABILITY_DROP: z.object({ minAvailability: z.coerce.number().min(0.01).max(1).default(0.95), windowHours: z.coerce.number().int().min(1).max(720).default(24) }),
  SESSION_INTERRUPTED: z.object({ windowHours: z.coerce.number().int().min(1).max(720).default(24) }),
  PAYMENT_DIVERGENCE: z.object({ staleAuthorizationHours: z.coerce.number().int().min(1).max(720).default(24) }),
} satisfies Record<AlertKind, z.ZodTypeAny>;

export function describeRule(kind: AlertKind, params: Record<string, number>) {
  switch (kind) {
    case "STATION_OFFLINE": return `Estação que já comunicou e está há mais de ${params.minutes} min além do limite de heartbeat (2 × intervalo + 60 s, relógio do servidor).`;
    case "REPEATED_FAULTS": return `${params.count} ou mais status "Em falha" no mesmo conector em ${params.windowMinutes} min.`;
    case "AVAILABILITY_DROP": return `Disponibilidade média dos conectores da estação abaixo de ${(params.minAvailability * 100).toFixed(0)}% nas últimas ${params.windowHours} h (tempo fora de Indisponível/Em falha/Sem comunicação ÷ janela). Estações sem comunicação ficam só no alerta de offline.`;
    case "SESSION_INTERRUPTED": return `Sessão com comunicação perdida, ou encerrada nas últimas ${params.windowHours} h por motivo anormal (EmergencyStop, PowerLoss, Reboot, reset, Other).`;
    case "PAYMENT_DIVERGENCE": return `Autorização pendente há mais de ${params.staleAuthorizationHours} h, pagamento sem sessão após 10 min, ou valor capturado diferente do apurado.`;
  }
}

const DEFAULTS: { kind: AlertKind; severity: "WARNING" | "CRITICAL"; createTicket: boolean; escalateAfterMinutes: number | null }[] = [
  { kind: "STATION_OFFLINE", severity: "CRITICAL", createTicket: true, escalateAfterMinutes: 60 },
  { kind: "REPEATED_FAULTS", severity: "CRITICAL", createTicket: true, escalateAfterMinutes: 120 },
  { kind: "AVAILABILITY_DROP", severity: "WARNING", createTicket: false, escalateAfterMinutes: null },
  { kind: "SESSION_INTERRUPTED", severity: "WARNING", createTicket: false, escalateAfterMinutes: null },
  { kind: "PAYMENT_DIVERGENCE", severity: "WARNING", createTicket: false, escalateAfterMinutes: 1440 },
];

/** Regras padrão idempotentes (seed/bootstrap). Notificação desligada até alguém configurar canais. */
export async function ensureDefaultAlertRules(client: PrismaClient, operatorId: string) {
  for (const d of DEFAULTS) {
    await client.alertRule.upsert({
      where: { operatorId_kind: { operatorId, kind: d.kind } },
      create: { operatorId, kind: d.kind, name: ALERT_KIND_LABEL[d.kind], severity: d.severity, params: PARAM_SCHEMAS[d.kind].parse({}), createTicket: d.createTicket, escalateAfterMinutes: d.escalateAfterMinutes, notifyChannels: [] },
      update: {},
    });
  }
}

export const ruleUpdateSchema = z.object({
  ruleId: z.string(),
  enabled: z.boolean(),
  severity: z.enum(["WARNING", "CRITICAL"]),
  params: z.record(z.string(), z.unknown()),
  cooldownMinutes: z.coerce.number().int().min(0).max(10080),
  escalateAfterMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  createTicket: z.boolean(),
  ticketPriority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  notifyChannels: z.array(z.enum(["EMAIL", "SMS", "WHATSAPP"])).max(3),
  includeNonProduction: z.boolean(),
});

export async function updateAlertRule(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "alert:configure");
  requireOperator(ctx);
  const d = ruleUpdateSchema.parse(raw);
  const rule = await db.alertRule.findFirst({ where: { id: d.ruleId, operatorId: ctx.organizationId } });
  if (!rule) throw notFound("Regra não encontrada.");
  const params = PARAM_SCHEMAS[rule.kind].parse(d.params);
  const { ruleId: _id, ...rest } = d;
  await db.alertRule.update({ where: { id: rule.id }, data: { ...rest, params, escalateAfterMinutes: d.escalateAfterMinutes ?? null, updatedById: ctx.userId } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "alert.rule_updated", entityType: "AlertRule", entityId: rule.id, data: { before: { enabled: rule.enabled, params: rule.params, channels: rule.notifyChannels }, after: { enabled: d.enabled, params, channels: d.notifyChannels } } });
}

export async function listAlertRules(ctx: AuthContext | null) {
  requirePermission(ctx, "alert:read");
  requireOperator(ctx);
  return db.alertRule.findMany({ where: { operatorId: ctx.organizationId }, orderBy: { kind: "asc" } });
}
