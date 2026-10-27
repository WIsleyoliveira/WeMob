import { getCurrentContext } from "@/server/auth/current";
import { exportEntriesCsv, exportStatementCsv } from "@/server/modules/finance/statement";
import { csvResponse, errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Exportações financeiras (finance:export), auditadas no serviço. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const ctx = await getCurrentContext();
    if (sp.get("tipo") === "lancamentos")
      return csvResponse(await exportEntriesCsv(ctx, { competence: sp.get("competencia") || undefined, kind: sp.get("sentido") || undefined, status: sp.get("situacao") || undefined }));
    return csvResponse(await exportStatementCsv(ctx, sp.get("periodo") ?? ""));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Período inválido")) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
