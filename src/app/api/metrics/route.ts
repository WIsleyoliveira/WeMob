import { collectMetrics, metricsAuthorized } from "@/server/modules/ops/metrics";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/**
 * Métricas no formato Prometheus para o monitoramento externo. Exige `Authorization: Bearer <METRICS_TOKEN>`;
 * sem o token configurado o endpoint não existe (404). Banco fora → 503 (o próprio monitor alerta).
 */
export async function GET(req: Request) {
  if (!metricsAuthorized(req.headers.get("authorization"))) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    return new Response(await collectMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("metrics_failed", { error: e instanceof Error ? e.message.slice(0, 200) : "erro" });
    return new Response("wemob_up 0\n", { status: 503, headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
