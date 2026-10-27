"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { cancelEntry, createAdjustment, createEntry, createTaxRule, endTaxRule, settleEntry } from "@/server/modules/finance/entries";
import { approveClosing, rejectClosing, requestClosing } from "@/server/modules/finance/closing";
import { initiatePayout } from "@/server/modules/finance/payouts";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const n = (f: FormData, k: string) => s(f, k)?.replace(",", ".");
const pct = (f: FormData, k: string) => {
  const v = s(f, k)?.replace(",", ".");
  return v === undefined ? undefined : Number(v) / 100;
};
const day = (f: FormData, k: string) => (s(f, k) ? `${s(f, k)}T00:00:00-03:00` : undefined);

export async function createEntryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    async () => void (await createEntry(ctx, { category: s(f, "category"), description: s(f, "description"), amount: n(f, "amount"), competence: s(f, "competence"), dueDate: day(f, "dueDate"), siteId: s(f, "siteId") })),
    "Lançamento registrado (provisionado).",
  );
  revalidatePath("/app/financeiro/lancamentos");
  return r;
}

export async function settleEntryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => settleEntry(ctx, { entryId: s(f, "entryId"), paidAt: day(f, "paidAt"), paidAmount: n(f, "paidAmount"), note: s(f, "note") }), "Baixa registrada.");
  revalidatePath("/app/financeiro", "layout");
  return r;
}

export async function cancelEntryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => cancelEntry(ctx, { entryId: s(f, "entryId"), reason: s(f, "reason") }), "Lançamento cancelado.");
  revalidatePath("/app/financeiro/lancamentos");
  return r;
}

export async function createAdjustmentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    async () => void (await createAdjustment(ctx, { adjustsPeriod: s(f, "adjustsPeriod"), contractId: s(f, "contractId"), kind: s(f, "kind"), amount: n(f, "amount"), description: s(f, "description") })),
    "Ajuste lançado no período aberto; o fechamento original não foi alterado.",
  );
  revalidatePath("/app/financeiro", "layout");
  return r;
}

export async function requestClosingAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await requestClosing(ctx, String(f.get("period")))).id);
  if (r.status === "ok" && r.data) redirect(`/app/financeiro/fechamento/${r.data}`);
  return r;
}

export async function approveClosingAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => approveClosing(ctx, String(f.get("closingId")), s(f, "note")), "Fechamento aprovado. Resultado registrado e repasses provisionados.");
  revalidatePath("/app/financeiro", "layout");
  return r;
}

export async function rejectClosingAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => rejectClosing(ctx, String(f.get("closingId")), { note: s(f, "note") }), "Fechamento recusado.");
  revalidatePath("/app/financeiro", "layout");
  return r;
}

export async function createTaxRuleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await createTaxRule(ctx, { name: s(f, "name"), rate: pct(f, "rate"), effectiveFrom: day(f, "effectiveFrom"), effectiveTo: day(f, "effectiveTo"), note: s(f, "note") })), "Tributo registrado.");
  revalidatePath("/app/financeiro/tributos");
  return r;
}

export async function endTaxRuleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => endTaxRule(ctx, { taxRuleId: s(f, "taxRuleId"), effectiveTo: day(f, "effectiveTo") }), "Vigência encerrada.");
  revalidatePath("/app/financeiro/tributos");
  return r;
}

export async function initiatePayoutAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  return toActionState(() => initiatePayout(ctx, { entryId: s(f, "entryId"), confirm: f.get("confirm") === "on" }));
}
