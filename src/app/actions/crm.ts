"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { AppError } from "@/server/errors";
import { convertLeadToPartner, linkLeadToCompany, updateLeadDetails } from "@/server/modules/crm/details";
import { completeTask, createTask } from "@/server/modules/crm/tasks";
import { createProposal, reviseProposal, setProposalStatus } from "@/server/modules/crm/proposals";
import { createStage, updateStage } from "@/server/modules/crm/stages";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const num = (f: FormData, k: string) => (s(f, k) === undefined ? undefined : Number(s(f, k)!.replace(/\./g, "").replace(",", ".")));
const parseItems = (f: FormData) => {
  try {
    return JSON.parse(String(f.get("items") ?? "[]"));
  } catch {
    throw new AppError("VALIDATION", "Itens da proposta inválidos.");
  }
};
const proposalContent = (f: FormData) => ({
  title: s(f, "title"),
  items: parseItems(f),
  validUntil: s(f, "validUntil"),
  conditions: s(f, "conditions"),
  modelVersionId: s(f, "modelVersionId"),
  simulationId: s(f, "simulationId"),
});

export async function updateLeadDetailsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => updateLeadDetails(ctx, { leadId: s(f, "leadId"), priority: s(f, "priority"), estimatedValue: num(f, "estimatedValue"), expectedCloseDate: s(f, "expectedCloseDate"), nextStep: s(f, "nextStep") }), "Qualificação atualizada.");
  revalidatePath(`/app/crm/${s(f, "leadId")}`);
  return r;
}

export async function linkCompanyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await linkLeadToCompany(ctx, { leadId: s(f, "leadId"), name: s(f, "name"), document: s(f, "document") })), "Empresa vinculada (registros existentes foram reaproveitados).");
  revalidatePath(`/app/crm/${s(f, "leadId")}`);
  return r;
}

export async function convertLeadAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => {
    const res = await convertLeadToPartner(ctx, { leadId: s(f, "leadId"), kind: s(f, "kind") });
    return res.reused;
  });
  revalidatePath(`/app/crm/${s(f, "leadId")}`);
  if (r.status === "ok") return { status: "ok", message: r.data ? "Organização já existia e foi reaproveitada." : "Organização criada. Acesso de usuários do parceiro deve ser concedido em Usuários e acessos." };
  return r;
}

export async function createTaskAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await createTask(ctx, { leadId: s(f, "leadId"), title: s(f, "title"), dueAt: s(f, "dueAt"), assigneeId: s(f, "assigneeId") })), "Tarefa criada.");
  revalidatePath("/app/crm", "layout");
  return r;
}

export async function completeTaskAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await completeTask(ctx, String(f.get("taskId")))), "Tarefa concluída.");
  revalidatePath("/app/crm", "layout");
  return r;
}

export async function createProposalAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await createProposal(ctx, { leadId: s(f, "leadId"), ...proposalContent(f) })).id);
  if (r.status === "ok" && r.data) redirect(`/app/crm/propostas/${r.data}`);
  return r;
}

export async function reviseProposalAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => reviseProposal(ctx, String(f.get("proposalId")), proposalContent(f)), "Nova versão registrada. A proposta voltou para rascunho.");
  revalidatePath(`/app/crm/propostas/${f.get("proposalId")}`);
  return r;
}

export async function setProposalStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => setProposalStatus(ctx, { proposalId: s(f, "proposalId"), status: s(f, "status") }), "Status atualizado.");
  revalidatePath(`/app/crm/propostas/${f.get("proposalId")}`);
  return r;
}

export async function updateStageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => updateStage(ctx, { stageId: s(f, "stageId"), name: s(f, "name"), probabilityPct: num(f, "probabilityPct") }), "Etapa atualizada.");
  revalidatePath("/app/crm", "layout");
  return r;
}

export async function createStageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await createStage(ctx, { name: s(f, "name"), probabilityPct: num(f, "probabilityPct") })), "Etapa criada antes de 'Ganho'.");
  revalidatePath("/app/crm", "layout");
  return r;
}
