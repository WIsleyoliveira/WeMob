import { getCurrentContext } from "@/server/auth/current";
import { exportLeadsCsv } from "@/server/modules/crm/export";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getCurrentContext();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  try {
    const { filename, content } = await exportLeadsCsv(ctx, { q: sp.q || undefined, stageId: sp.stageId || undefined, source: sp.source || undefined });
    return new Response(content, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 400 });
    throw e;
  }
}
