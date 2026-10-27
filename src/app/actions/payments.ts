"use server";
import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { reconcile, requestRefund, resolveReview } from "@/server/payments/service";
import { createRecipient, createSplitPolicy, decideSplitPolicy, disableRecipient, validateRecipient } from "@/server/payments/split";
import { decideActivation, requestActivation, revokeActivation, ACTIVATION_ITEMS } from "@/server/payments/activation";

export async function refundAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await requestRefund(ctx, { paymentId: f.get("paymentId"), amount: String(f.get("amount") ?? "").replace(",", "."), reason: f.get("reason") })).status);
  revalidatePath(`/app/pagamentos/${f.get("paymentId")}`);
  if (r.status !== "ok") return r as ActionState;
  return {
    status: "ok",
    message: r.data === "SUCCEEDED" ? "Estorno confirmado pelo provedor." : "Estorno solicitado. Ainda NÃO está concluído: será confirmado quando o provedor informar (webhook ou consulta).",
  };
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

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const done = (path: string) => revalidatePath(path);

export async function resolveReviewAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => resolveReview(ctx, { paymentId: str(f, "paymentId"), note: str(f, "note") }), "Análise encerrada e registrada na auditoria.");
  done(`/app/pagamentos/${f.get("paymentId")}`);
  return r;
}

export async function createRecipientAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await createRecipient(ctx, { organizationId: str(f, "organizationId"), environment: str(f, "environment"), walletId: str(f, "walletId"), note: str(f, "note") })), "Recebedor cadastrado. Outra pessoa precisa validar o walletId antes do uso no split.");
  done("/app/pagamentos/split");
  return r;
}

export async function validateRecipientAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => validateRecipient(ctx, String(f.get("recipientId"))), "Recebedor validado.");
  done("/app/pagamentos/split");
  return r;
}

export async function disableRecipientAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => disableRecipient(ctx, String(f.get("recipientId"))), "Recebedor desativado. Novas cobranças não o incluirão no split.");
  done("/app/pagamentos/split");
  return r;
}

export async function createSplitPolicyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const participants = [0, 1, 2]
    .map((i) => ({ kind: str(f, `p${i}.kind`), recipientId: str(f, `p${i}.recipientId`), percentualValue: str(f, `p${i}.pct`)?.replace(",", "."), fixedValue: str(f, `p${i}.fixed`)?.replace(",", "."), description: str(f, `p${i}.description`) }))
    .filter((p) => p.kind);
  const r = await toActionState(async () => void (await createSplitPolicy(ctx, { siteId: str(f, "siteId"), effectiveFrom: str(f, "effectiveFrom"), feeTreatment: str(f, "feeTreatment"), reason: str(f, "reason"), participants })), "Política criada em rascunho. Outra pessoa precisa aprovar.");
  done("/app/pagamentos/split");
  return r;
}

export async function decideSplitPolicyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const approve = f.get("decision") === "approve";
  const r = await toActionState(() => decideSplitPolicy(ctx, String(f.get("policyId")), { approve, note: str(f, "note") }), approve ? "Política aprovada: vale para novas cobranças a partir da vigência." : "Política recusada.");
  done("/app/pagamentos/split");
  return r;
}

export async function requestActivationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const checklist = Object.fromEntries(Object.keys(ACTIVATION_ITEMS).map((k) => [k, f.get(k) === "on"]));
  const r = await toActionState(async () => void (await requestActivation(ctx, { checklist, note: str(f, "note") })), "Solicitação registrada. Um superadministrador diferente precisa aprovar.");
  done("/app/pagamentos/gateway");
  return r;
}

export async function decideActivationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const approve = f.get("decision") === "approve";
  const r = await toActionState(() => decideActivation(ctx, String(f.get("activationId")), { approve, note: str(f, "note") }), approve ? "Habilitação aprovada. Produção só opera se a configuração do servidor também estiver em produção." : "Habilitação recusada.");
  done("/app/pagamentos/gateway");
  return r;
}

export async function revokeActivationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => revokeActivation(ctx, String(f.get("activationId")), String(f.get("reason") ?? "")), "Habilitação revogada: novas cobranças reais ficam bloqueadas.");
  done("/app/pagamentos/gateway");
  return r;
}
