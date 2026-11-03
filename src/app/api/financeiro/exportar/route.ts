import { getCurrentContext } from "@/server/auth/current";
import { exportEntries, exportStatement } from "@/server/modules/finance/statement";
import { errorResponse, exportResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Exportações financeiras (finance:export), auditadas no serviço. `formato=xlsx` → Excel nativo; padrão CSV. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const ctx = await getCurrentContext();
    const format = sp.get("formato") === "xlsx" ? "xlsx" : "csv";
    if (sp.get("tipo") === "lancamentos")
      return exportResponse(await exportEntries(ctx, { competence: sp.get("competencia") || undefined, kind: sp.get("sentido") || undefined, status: sp.get("situacao") || undefined }, format));
    return exportResponse(await exportStatement(ctx, sp.get("periodo") ?? "", format));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Período inválido")) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
