"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/server/auth/session";
import { SESSION_COOKIE, requestMeta } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const meta = await requestMeta();
  const res = await toActionState(() => login({ email: form.get("email"), password: form.get("password") }, meta));
  if (res.status !== "ok" || !res.data) return res as ActionState;
  (await cookies()).set(SESSION_COOKIE, res.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: res.data.expiresAt,
  });
  redirect("/app");
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
