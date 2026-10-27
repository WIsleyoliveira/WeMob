"use server";
import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { reconcile, requestRefund } from "@/server/payments/service";

export async function refundAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await requestRefund(ctx, { paymentId: f.get("paymentId"), amount: String(f.get("amount") ?? "").replace(",", "."), reason: f.get("reason") })), "Reembolso confirmado pelo provedor.");
  revalidatePath(`/app/pagamentos/${f.get("paymentId")}`);
  return r;
}

export async function reconcileAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const from = new Date(`${f.get("de")}T00:00:00-03:00`);
  const to = new Date(`${f.get("ate")}T23:59:59.999-03:00`);
  const r = await toActionState(() => reconcile(ctx, { from, to }));
  revalidatePath("/app/pagamentos");
  if (r.status !== "ok" || !r.data) return r as ActionState;
  const d = r.data;
  return {
    status: "ok",
    message:
      `Conferidos ${d.checked} pagamento(s) e ${d.sessionsChecked} sessão(ões); ${d.matched} conciliado(s); ${d.divergences.length} divergência(s).` +
      (d.divergences.length ? " " + d.divergences.map((x) => `[${x.kind}] ${x.text}`).join(" | ") : ""),
  };
}
