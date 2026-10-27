import { AppError } from "./errors";

/** Converte AppError em resposta JSON com status HTTP; demais erros seguem para o tratador do Next. */
export function errorResponse(e: unknown) {
  if (!(e instanceof AppError)) throw e;
  const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "RATE_LIMITED" ? 429 : 400;
  return Response.json({ error: e.message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function csvResponse({ filename, content }: { filename: string; content: string }) {
  return new Response(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
