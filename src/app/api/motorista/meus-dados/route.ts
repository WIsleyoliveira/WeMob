import { getDriver } from "@/server/drivers/current";
import { exportMyData } from "@/server/drivers/service";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Portabilidade/acesso (LGPD): somente os dados do próprio motorista autenticado. */
export async function GET() {
  try {
    const data = await exportMyData(await getDriver());
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="meus-dados-sansol-mob.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
