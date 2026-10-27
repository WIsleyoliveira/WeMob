"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { addContractSite, createAmendment, createContract, decideContractVersion, setContractStatus } from "@/server/modules/contracts/service";
import { addAttachment, type AttachmentEntity } from "@/server/modules/attachments/service";
import { AppError } from "@/server/errors";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const pct = (f: FormData, k: string) => {
  const v = s(f, k)?.replace(",", ".");
  return v === undefined ? undefined : Number(v) / 100;
};
const day = (f: FormData, k: string) => (s(f, k) ? `${s(f, k)}T00:00:00-03:00` : undefined);

/** Condições digitadas em % na tela → frações no serviço. */
const terms = (f: FormData) => ({
  effectiveFrom: day(f, "effectiveFrom"),
  effectiveTo: day(f, "effectiveTo"),
  commercialModelVersionId: s(f, "commercialModelVersionId"),
  royaltyRate: pct(f, "royaltyRate"),
  royaltyBase: s(f, "royaltyBase"),
  platformFeeRate: pct(f, "platformFeeRate"),
  partnerShareRate: pct(f, "partnerShareRate"),
  partnerShareBase: s(f, "partnerShareBase"),
  lossTreatment: s(f, "lossTreatment"),
  paymentTermDays: s(f, "paymentTermDays"),
  conditions: s(f, "conditions"),
  reason: s(f, "reason"),
});

export async function createContractAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await createContract(ctx, { contract: { partnerOrganizationId: s(f, "partnerOrganizationId"), title: s(f, "title"), siteIds: f.getAll("siteIds").map(String) }, terms: terms(f) })).id);
  if (r.status === "ok" && r.data) redirect(`/app/contratos/${r.data}`);
  return r;
}

export async function createAmendmentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const id = String(f.get("contractId"));
  const r = await toActionState(async () => void (await createAmendment(ctx, id, terms(f))), "Aditivo criado em rascunho. Outra pessoa autorizada deve aprová-lo.");
  revalidatePath(`/app/contratos/${id}`);
  return r;
}

export async function decideVersionAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const approve = f.get("decision") === "approve";
  const r = await toActionState(() => decideContractVersion(ctx, String(f.get("versionId")), { approve, note: s(f, "note") }), approve ? "Versão aprovada." : "Versão recusada.");
  revalidatePath(`/app/contratos/${f.get("contractId")}`);
  return r;
}

export async function setContractStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => setContractStatus(ctx, String(f.get("contractId")), { status: s(f, "status"), reason: s(f, "reason") }), "Status do contrato atualizado.");
  revalidatePath(`/app/contratos/${f.get("contractId")}`);
  return r;
}

export async function addContractSiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => addContractSite(ctx, String(f.get("contractId")), String(f.get("siteId"))), "Unidade vinculada.");
  revalidatePath(`/app/contratos/${f.get("contractId")}`);
  return r;
}

const RETURN_PATH: Record<AttachmentEntity, string> = { Contract: "/app/contratos/", Ticket: "/app/suporte/", WorkOrder: "/app/manutencao/os/", FinancialEntry: "/app/financeiro/lancamentos#" };

/** Upload de anexo (tipo validado pelo conteúdo no servidor). */
export async function uploadAttachmentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const entityType = String(f.get("entityType")) as AttachmentEntity;
  const entityId = String(f.get("entityId"));
  const file = f.get("file");
  const r = await toActionState(async () => {
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Selecione um arquivo.");
    await addAttachment(ctx, { entityType, entityId, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), visibleToPartner: f.get("visibleToPartner") === "on" });
  }, "Anexo enviado.");
  if (RETURN_PATH[entityType]) revalidatePath(`${RETURN_PATH[entityType]}${entityId}`);
  return r;
}
