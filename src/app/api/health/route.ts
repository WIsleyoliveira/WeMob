import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { schemaState, type MigrationRow } from "@/domain/ops/schema";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness. Verifica o banco (503 se inacessível) e informa, sem detalhes internos,
 * se o ciclo de automações do processo OCPP está rodando (última execução há ≤ 5 min).
 * O status HTTP depende só do banco: o worker parado não derruba o site, mas fica visível ao monitoramento.
 * Banco acessível sem as tabelas → `schema: "migrations_pending"` (rodar a etapa de migração do deploy).
 * Banco já populado: compara `_prisma_migrations` com a última migração que o código espera — pendente ou com falha
 * → 503 (`migrations_pending` / `migration_failed`), para o balanceador não mandar tráfego a um schema errado.
 * `?exigir=automacao`: também 503 quando o ciclo de automações não está "ok" — para o MONITOR EXTERNO alertar (o
 * próprio ciclo parado não consegue avisar ninguém). O health padrão continua 200 nesse caso.
 */
export async function GET(req: Request) {
  const requireAutomation = new URL(req.url).searchParams.get("exigir") === "automacao";
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const rows = await db.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const schema = schemaState(rows);
    if (schema !== "ok") return Response.json({ status: "degraded", db: "ok", schema, time: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const last = await db.automationRun.findFirst({ where: { job: "alerts.evaluate" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } });
    const automation = !last ? "never" : Date.now() - last.startedAt.getTime() > 5 * 60_000 ? "stale" : last.status === "FAILED" ? "failing" : "ok";
    const body = { status: requireAutomation && automation !== "ok" ? "degraded" : "ok", db: "ok", schema, automation, latencyMs: Date.now() - started, time: new Date().toISOString() };
    return Response.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Banco acessível mas sem as tabelas = migrações não aplicadas (a aplicação não migra ao iniciar).
    const schemaMissing = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021";
    return Response.json(
      { status: "degraded", db: schemaMissing ? "ok" : "unreachable", ...(schemaMissing ? { schema: "migrations_pending" } : {}), time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
