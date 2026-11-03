"use server";
import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { cancelCostActual, deactivateCostItem, recordCostActual, updateCostAssumptions, upsertCostItem } from "@/server/modules/costs/service";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const num = (f: FormData, k: string) => s(f, k)?.replace(",", ".");
// Percentuais digitados como 40 (%) → 0,40.
const pct = (f: FormData, k: string) => {
  const v = num(f, k);
  return v === undefined ? undefined : Number(v) / 100;
};
const PATH = "/app/financeiro/custos";

export async function upsertCostItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await upsertCostItem(ctx, { key: s(f, "key"), name: s(f, "name"), category: s(f, "category"), baseMonthly: num(f, "baseMonthly"), fxExposure: pct(f, "fxExposure") })), "Item salvo.");
  revalidatePath(PATH);
  return r;
}

export async function deactivateCostItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => deactivateCostItem(ctx, String(f.get("key"))), "Item retirado do orçamento.");
  revalidatePath(PATH);
  return r;
}

export async function updateCostAssumptionsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    () => updateCostAssumptions(ctx, { fxStressRate: pct(f, "fxStressRate"), reserveRate: pct(f, "reserveRate"), perStationCost: num(f, "perStationCost"), perStationReserve: num(f, "perStationReserve"), budgetTolerance: pct(f, "budgetTolerance"), sourceNote: s(f, "sourceNote") }),
    "Premissas atualizadas.",
  );
  revalidatePath(PATH);
  return r;
}

export async function recordCostActualAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    async () => void (await recordCostActual(ctx, { competence: s(f, "competence"), itemKey: s(f, "itemKey"), category: s(f, "category"), description: s(f, "description"), currency: s(f, "currency"), amount: num(f, "amount"), originalAmount: num(f, "originalAmount"), fxRate: num(f, "fxRate") })),
    "Custo realizado registrado.",
  );
  revalidatePath(PATH);
  return r;
}

export async function cancelCostActualAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => cancelCostActual(ctx, String(f.get("id")), String(f.get("reason") ?? "")), "Lançamento cancelado.");
  revalidatePath(PATH);
  return r;
}
