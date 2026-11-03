import { NextResponse, type NextRequest } from "next/server";

/**
 * ID de correlação por requisição: reaproveita o `x-request-id` do proxy quando válido; senão gera um. Vai para o
 * servidor (cabeçalho da requisição) e volta ao cliente (cabeçalho da resposta), para cruzar logs e chamados.
 */
const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

export function middleware(req: NextRequest) {
  const incoming = req.headers.get("x-request-id");
  const id = incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", id);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", id);
  return res;
}

export const config = {
  // Arquivos estáticos não precisam de correlação.
  matcher: ["/((?!_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
