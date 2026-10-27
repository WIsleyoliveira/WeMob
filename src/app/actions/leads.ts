"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext, requestMeta } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { addLeadActivity, assignLead, createManualLead, moveLeadStage, submitPublicLead } from "@/server/modules/leads/service";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};

const leadFields = (f: FormData) => ({
  contactName: str(f, "contactName"),
  email: str(f, "email"),
  phone: str(f, "phone"),
  companyName: str(f, "companyName"),
  businessType: str(f, "businessType"),
  city: str(f, "city"),
  state: str(f, "state"),
  interestModel: str(f, "interestModel"),
  message: str(f, "message"),
  campaign: str(f, "campaign"),
});

export async function submitLeadAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const meta = await requestMeta();
  return toActionState(
    () =>
      submitPublicLead(
        { ...leadFields(f), source: str(f, "source") ?? "WEBSITE_CONTACT", consent: f.get("consent") === "on" },
        { ip: meta.ip, honeypot: str(f, "website"), formStartedAt: Number(f.get("startedAt")) || undefined },
      ),
    "Recebemos sua solicitação. Nossa equipe comercial entrará em contato.",
  );
}

export async function createLeadAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => createManualLead(ctx, { ...leadFields(f), source: str(f, "source") ?? "MANUAL" }));
  if (res.status === "ok" && res.data) redirect(`/app/crm/${(res.data as { id: string }).id}`);
  return res;
}

export async function moveStageAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => moveLeadStage(ctx, { leadId: str(f, "leadId"), stageId: str(f, "stageId"), lostReason: str(f, "lostReason") }), "Etapa atualizada.");
  revalidatePath("/app/crm", "layout");
  return res;
}

export async function addActivityAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => addLeadActivity(ctx, { leadId: str(f, "leadId"), kind: str(f, "kind"), body: str(f, "body") }), "Registro adicionado.");
  revalidatePath(`/app/crm/${str(f, "leadId")}`);
  return res;
}

export async function assignLeadAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => assignLead(ctx, { leadId: str(f, "leadId"), assigneeId: str(f, "assigneeId") ?? null }), "Responsável atualizado.");
  revalidatePath(`/app/crm/${str(f, "leadId")}`);
  return res;
}
