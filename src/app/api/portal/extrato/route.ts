import { getCurrentContext } from "@/server/auth/current";
import { exportPartnerStatement } from "@/server/modules/partner/portal";
import { errorResponse, exportResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Extrato do parceiro: só as linhas da própria organização; exportação auditada. */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    return exportResponse(await exportPartnerStatement(await getCurrentContext(), sp.get("periodo") ?? "", sp.get("formato") === "xlsx" ? "xlsx" : "csv"));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Período inválido")) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
