"use server";
import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { approveVersion, createDraftVersion, saveSimulation } from "@/server/modules/commercial/service";

const pctToFraction = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(String(v).replace(",", ".")) / 100);
const n = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(String(v).replace(",", ".")));

export async function createDraftVersionAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(
    () =>
      createDraftVersion(ctx, String(f.get("modelId")), {
        referenceInvestment: n(f.get("referenceInvestment")),
        partnerCapitalShare: pctToFraction(f.get("partnerCapitalShare")),
        partnerResultShare: pctToFraction(f.get("partnerResultShare")),
        royaltyRate: pctToFraction(f.get("royaltyRate")),
        royaltyBase: f.get("royaltyBase"),
        platformFeeRate: pctToFraction(f.get("platformFeeRate")),
        platformFeeBase: "GROSS_REVENUE",
        taxRate: pctToFraction(f.get("taxRate")),
        taxBase: f.get("taxBase"),
        maintenancePolicy: f.get("maintenancePolicy"),
        sourceNote: f.get("sourceNote") || undefined,
        effectiveFrom: f.get("effectiveFrom") || undefined,
      }),
    "Versão criada em rascunho. Outro administrador deve aprová-la.",
  );
  revalidatePath("/app/modelos");
  return res;
}

export async function approveVersionAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => approveVersion(ctx, String(f.get("versionId"))), "Versão aprovada e vigente para novas simulações e contratos.");
  revalidatePath("/app/modelos");
  return res;
}

export async function saveSimulationAction(payload: { name: string; versionId: string; leadId?: string; input: Record<string, unknown> }): Promise<ActionState<{ id: string }>> {
  const ctx = await getCurrentContext();
  const res = await toActionState(async () => {
    const s = await saveSimulation(ctx, payload);
    return { id: s.id };
  }, "Simulação salva. Os resultados foram recalculados no servidor.");
  revalidatePath("/app/simulador");
  return res;
}
