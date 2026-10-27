import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + readiness: verifica conexão com o banco. Não expõe detalhes internos. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", latencyMs: Date.now() - started, time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "degraded", db: "unreachable", time: new Date().toISOString() }, { status: 503 });
  }
}
