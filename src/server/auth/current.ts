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
  if (perm && !ctx.permissions.has(perm)) redirect("/app?negado=1");
  return ctx;
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
