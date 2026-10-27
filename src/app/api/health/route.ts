import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness. Verifica o banco (503 se inacessível) e informa, sem detalhes internos,
 * se o ciclo de automações do processo OCPP está rodando (última execução há ≤ 5 min).
 * O status HTTP depende só do banco: o worker parado não derruba o site, mas fica visível ao monitoramento.
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const last = await db.automationRun.findFirst({ where: { job: "alerts.evaluate" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } });
    const automation = !last ? "never" : Date.now() - last.startedAt.getTime() > 5 * 60_000 ? "stale" : last.status === "FAILED" ? "failing" : "ok";
    return Response.json({ status: "ok", db: "ok", automation, latencyMs: Date.now() - started, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", db: "unreachable", time: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
