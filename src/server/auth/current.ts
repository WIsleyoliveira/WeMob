import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession } from "./session";
import type { Permission } from "./permissions";

export const SESSION_COOKIE = "sm_session";

export const getCurrentContext = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token);
});

/** Para páginas: exige sessão (e permissão, se informada); caso contrário redireciona. */
export async function requirePage(perm?: Permission) {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");
  if (perm && !ctx.permissions.has(perm)) redirect("/app/sem-permissao");
  return ctx;
}

/**
 * IP do cliente. Cabeçalhos X-Forwarded-For/X-Real-IP são forjáveis: só são aceitos quando
 * TRUST_PROXY=1 (app atrás de proxy reverso que os sobrescreve). Sem isso, o IP fica indefinido
 * e valem apenas os limites por e-mail e o limite global.
 */
export async function requestMeta() {
  const h = await headers();
  const trusted = process.env.TRUST_PROXY === "1";
  return {
    ip: trusted ? h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || undefined : undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
