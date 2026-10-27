import { getCurrentContext } from "@/server/auth/current";
import { exportPartnerStatementCsv } from "@/server/modules/partner/portal";
import { csvResponse, errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Extrato do parceiro: só as linhas da própria organização; exportação auditada. */
export async function GET(req: Request) {
  try {
    return csvResponse(await exportPartnerStatementCsv(await getCurrentContext(), new URL(req.url).searchParams.get("periodo") ?? ""));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Período inválido")) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
