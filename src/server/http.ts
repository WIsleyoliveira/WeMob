import { AppError } from "./errors";
import { XLSX_CONTENT_TYPE } from "@/lib/xlsx";

/** Converte AppError em resposta JSON com status HTTP; demais erros seguem para o tratador do Next. */
export function errorResponse(e: unknown) {
  if (!(e instanceof AppError)) throw e;
  const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "RATE_LIMITED" ? 429 : 400;
  return Response.json({ error: e.message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function csvResponse({ filename, content }: { filename: string; content: string }) {
  return new Response(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}

/** Download de exportação: CSV (texto) ou Excel (.xlsx, binário). */
export function exportResponse({ filename, content }: { filename: string; content: string | Buffer }) {
  if (typeof content === "string") return csvResponse({ filename, content });
  return new Response(new Uint8Array(content), {
    headers: { "Content-Type": XLSX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
