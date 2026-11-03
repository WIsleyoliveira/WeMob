/**
 * Métricas operacionais para monitoramento externo (Prometheus/Grafana, Better Stack, Datadog…): banco, schema,
 * automação, estações, sessões, filas de webhook/estorno/comandos e alertas. Valores agregados de PRODUÇÃO (estações
 * de teste/simulação ficam separadas por rótulo). Sem dado pessoal, sem valores financeiros por cliente.
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { schemaState, type MigrationRow } from "@/domain/ops/schema";
import { renderMetrics, type Metric } from "@/domain/ops/metrics";

/** `METRICS_TOKEN` ausente = endpoint desligado. Comparação em tempo constante. */
export function metricsAuthorized(authorization: string | null, token = process.env.METRICS_TOKEN) {
  if (!token || token.length < 24) return false;
  const given = Buffer.from((authorization ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const g = (name: string, help: string, samples: Metric["samples"]): Metric => ({ name, help, type: "gauge", samples });

export async function collectMetrics(now = new Date()): Promise<string> {
  const t0 = Date.now();
  await db.$queryRaw`SELECT 1`;
  const dbLatency = Date.now() - t0;
  const [migrations, lastRun, stations, sessions, webhookPending, webhookRetrying, refunds, commands, alerts, paymentsPending] = await Promise.all([
    db.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    db.automationRun.findFirst({ where: { job: "alerts.evaluate" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }),
    db.chargingStation.groupBy({ by: ["environment", "connectionState"], where: { deletedAt: null }, _count: { _all: true } }),
    db.chargingSession.groupBy({ by: ["environment", "status"], where: { status: { in: ["ACTIVE", "COMMUNICATION_LOST"] } }, _count: { _all: true } }),
    db.paymentEvent.count({ where: { processedAt: null } }),
    db.paymentEvent.count({ where: { processedAt: null, attempts: { gt: 0 } } }),
    db.refund.groupBy({ by: ["status"], where: { status: { in: ["REQUESTED", "SCHEDULED", "FAILED"] } }, _count: { _all: true } }),
    db.remoteCommand.groupBy({ by: ["status"], where: { status: { in: ["PENDING", "SENT"] } }, _count: { _all: true } }),
    db.alert.groupBy({ by: ["severity"], where: { status: { not: "RESOLVED" } }, _count: { _all: true } }),
    db.payment.count({ where: { status: { in: ["PENDING", "AUTHORIZED"] }, environment: "PRODUCTION" } }),
  ]);
  const schema = schemaState(migrations);
  return renderMetrics([
    g("wemob_up", "Aplicação respondendo e banco acessível (1 = sim).", [{ value: 1 }]),
    g("wemob_db_latency_ms", "Latência de um SELECT 1 no banco, em ms.", [{ value: dbLatency }]),
    g("wemob_schema_ok", "Última migração esperada aplicada (1) ou pendente/com falha (0).", [{ labels: { state: schema }, value: schema === "ok" ? 1 : 0 }]),
    g("wemob_automation_last_run_age_seconds", "Segundos desde a última execução do ciclo de automações (-1 = nunca).", [{ labels: { status: lastRun?.status ?? "never" }, value: lastRun ? Math.round((now.getTime() - lastRun.startedAt.getTime()) / 1000) : -1 }]),
    g("wemob_stations", "Estações por ambiente e estado de conexão.", stations.map((s) => ({ labels: { environment: s.environment, state: s.connectionState }, value: s._count._all }))),
    g("wemob_sessions_open", "Sessões em andamento por ambiente e estado (COMMUNICATION_LOST = sem comunicação).", sessions.map((s) => ({ labels: { environment: s.environment, status: s.status }, value: s._count._all }))),
    g("wemob_webhook_events_pending", "Eventos de webhook recebidos e ainda não processados.", [{ value: webhookPending }]),
    g("wemob_webhook_events_retrying", "Eventos de webhook pendentes que já falharam ao menos uma vez.", [{ value: webhookRetrying }]),
    g("wemob_refunds_open", "Estornos aguardando gateway, agendados ou com falha.", refunds.map((r) => ({ labels: { status: r.status }, value: r._count._all }))),
    g("wemob_remote_commands_open", "Comandos OCPP na fila ou enviados sem resposta.", commands.map((c) => ({ labels: { status: c.status }, value: c._count._all }))),
    g("wemob_alerts_open", "Alertas não resolvidos por severidade.", alerts.map((a) => ({ labels: { severity: a.severity }, value: a._count._all }))),
    g("wemob_payments_pending_production", "Pagamentos de produção pendentes ou só autorizados.", [{ value: paymentsPending }]),
  ]);
}
