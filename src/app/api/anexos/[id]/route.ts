import { getCurrentContext } from "@/server/auth/current";
import { getAttachmentForDownload } from "@/server/modules/attachments/service";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Download de anexo: autorização pela entidade dona; sempre como download, nunca renderizado inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const a = await getAttachmentForDownload(await getCurrentContext(), (await params).id);
    return new Response(new Uint8Array(a.data), {
      headers: {
        "Content-Type": a.mimeType,
        "Content-Length": String(a.size),
        "Content-Disposition": `attachment; filename="${a.filename}"`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
