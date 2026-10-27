import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DRIVER_COOKIE, resolveDriver } from "./auth";

export const getDriver = cache(async () => resolveDriver((await cookies()).get(DRIVER_COOKIE)?.value));

export async function requireDriverPage(next?: string) {
  const d = await getDriver();
  if (!d) redirect(`/motorista/entrar${next ? `?voltar=${encodeURIComponent(next)}` : ""}`);
  return d;
}
