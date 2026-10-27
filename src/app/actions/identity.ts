"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { revokeMembership } from "@/server/modules/identity/service";
import { changePassword, createPasswordResetLink, requestPasswordReset, resetPasswordWithToken } from "@/server/modules/identity/password-reset";

async function baseUrl() {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function revokeMembershipAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => revokeMembership(ctx, String(f.get("membershipId"))), "Acesso revogado e sessões encerradas.");
  revalidatePath("/app/usuarios");
  return res;
}

export async function createResetLinkAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => createPasswordResetLink(ctx, String(f.get("membershipId"))));
  if (res.status !== "ok" || !res.data) return res as ActionState;
  return {
    status: "ok",
    message: `Link de uso único (válido por ${res.data.expiresInMinutes} min). Entregue ao usuário por canal seguro; ele não será exibido novamente: ${await baseUrl()}/redefinir-senha?token=${res.data.token}`,
  };
}

export async function requestResetAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const res = await toActionState(async () => requestPasswordReset(f.get("email"), { baseUrl: await baseUrl() }));
  if (res.status !== "ok" || !res.data) return res as ActionState;
  return {
    status: "ok",
    message:
      res.data.emailChannel === "configured"
        ? "Se o e-mail estiver cadastrado, você receberá um link em instantes."
        : "O envio de e-mails ainda não está configurado nesta plataforma. Peça ao administrador da sua organização um link de redefinição.",
  };
}

export async function resetPasswordAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  return toActionState(
    () => resetPasswordWithToken({ token: f.get("token"), password: f.get("password"), confirm: f.get("confirm") }),
    "Senha redefinida. Todas as sessões anteriores foram encerradas; entre novamente.",
  );
}

export async function changePasswordAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  return toActionState(
    () => changePassword(ctx, { currentPassword: f.get("currentPassword"), password: f.get("password"), confirm: f.get("confirm") }),
    "Senha alterada. As demais sessões foram encerradas.",
  );
}
