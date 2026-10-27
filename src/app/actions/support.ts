"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { addTicketComment, assignTicket, changeTicketPriority, changeTicketStatus, createTicket, saveSlaPolicy } from "@/server/modules/support/tickets";
import { addPart, cancelWorkOrder, completeWorkOrder, createPlan, createWorkOrder, setChecklist, setPlanActive, updateWorkOrder } from "@/server/modules/maintenance/service";
import { acknowledgeAlert, resolveAlert } from "@/server/modules/alerts/engine";
import { updateAlertRule } from "@/server/modules/alerts/rules";
import { setNotificationConsent } from "@/server/modules/alerts/notifications";
import { runOperationsNow } from "@/server/modules/automation/runner";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const n = (f: FormData, k: string) => s(f, k)?.replace(",", ".");
const lines = (f: FormData, k: string) => (s(f, k) ?? "").split("\n").map((x) => x.trim()).filter(Boolean);

// ── Tickets ──
export async function createTicketAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await createTicket(ctx, { title: s(f, "title"), description: s(f, "description"), category: s(f, "category"), priority: s(f, "priority"), stationId: s(f, "stationId"), siteId: s(f, "siteId") })).id);
  if (r.status === "ok" && r.data) redirect(`/app/suporte/${r.data}`);
  return r;
}

export async function ticketStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => changeTicketStatus(ctx, { ticketId: s(f, "ticketId"), status: s(f, "status"), reason: s(f, "reason") }), "Status atualizado.");
  revalidatePath(`/app/suporte/${f.get("ticketId")}`);
  return r;
}

export async function ticketCommentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => addTicketComment(ctx, { ticketId: s(f, "ticketId"), body: s(f, "body") }), "Comentário registrado.");
  revalidatePath(`/app/suporte/${f.get("ticketId")}`);
  return r;
}

export async function ticketAssignAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => assignTicket(ctx, { ticketId: s(f, "ticketId"), assigneeId: s(f, "assigneeId") }), "Responsável atualizado.");
  revalidatePath(`/app/suporte/${f.get("ticketId")}`);
  return r;
}

export async function ticketPriorityAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => changeTicketPriority(ctx, { ticketId: s(f, "ticketId"), priority: s(f, "priority"), reason: s(f, "reason") }), "Prioridade e prazos de SLA atualizados.");
  revalidatePath(`/app/suporte/${f.get("ticketId")}`);
  return r;
}

export async function saveSlaPolicyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    () => saveSlaPolicy(ctx, { priority: s(f, "priority"), contractId: s(f, "contractId"), responseMinutes: s(f, "responseMinutes"), resolutionMinutes: s(f, "resolutionMinutes"), businessHoursOnly: f.get("businessHoursOnly") === "on", workStartHour: s(f, "workStartHour"), workEndHour: s(f, "workEndHour"), workDays: f.getAll("workDays").map(String) }),
    "Política salva. Tickets já abertos mantêm os prazos que tinham.",
  );
  revalidatePath("/app/suporte/configurar");
  return r;
}

// ── Ordens de serviço ──
export async function createWorkOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await createWorkOrder(ctx, { stationId: s(f, "stationId"), title: s(f, "title"), ticketId: s(f, "ticketId"), diagnosis: s(f, "diagnosis"), checklist: lines(f, "checklist") })).id);
  if (r.status === "ok" && r.data) redirect(`/app/manutencao/os/${r.data}`);
  return r;
}

export async function updateWorkOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => updateWorkOrder(ctx, { workOrderId: s(f, "workOrderId"), status: s(f, "status"), diagnosis: s(f, "diagnosis"), technicianName: s(f, "technicianName"), scheduledFor: s(f, "scheduledFor") ? `${s(f, "scheduledFor")}:00-03:00` : undefined }), "Ordem de serviço atualizada.");
  revalidatePath(`/app/manutencao/os/${f.get("workOrderId")}`);
  return r;
}

export async function checklistAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const items = f.getAll("item").map(String).map((item, i) => ({ item, done: f.get(`done_${i}`) === "on" }));
  for (const extra of lines(f, "newItems")) items.push({ item: extra, done: false });
  const r = await toActionState(() => setChecklist(ctx, { workOrderId: s(f, "workOrderId"), items }), "Checklist salvo.");
  revalidatePath(`/app/manutencao/os/${f.get("workOrderId")}`);
  return r;
}

export async function addPartAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => addPart(ctx, { workOrderId: s(f, "workOrderId"), description: s(f, "description"), quantity: n(f, "quantity"), unitCost: n(f, "unitCost") }), "Peça registrada.");
  revalidatePath(`/app/manutencao/os/${f.get("workOrderId")}`);
  return r;
}

export async function completeWorkOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => completeWorkOrder(ctx, { workOrderId: s(f, "workOrderId"), completionNotes: s(f, "completionNotes"), laborCost: n(f, "laborCost") ?? 0 }), "Ordem de serviço concluída; custo lançado como despesa de manutenção.");
  revalidatePath(`/app/manutencao/os/${f.get("workOrderId")}`);
  return r;
}

export async function cancelWorkOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => cancelWorkOrder(ctx, { workOrderId: s(f, "workOrderId"), reason: s(f, "reason") }), "Ordem de serviço cancelada.");
  revalidatePath(`/app/manutencao/os/${f.get("workOrderId")}`);
  return r;
}

export async function createPlanAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(
    async () => void (await createPlan(ctx, { stationId: s(f, "stationId"), name: s(f, "name"), trigger: s(f, "trigger"), intervalDays: s(f, "intervalDays"), intervalKwh: s(f, "intervalKwh"), intervalSessions: s(f, "intervalSessions"), checklist: lines(f, "checklist") })),
    "Plano criado. A verificação de vencimento roda a cada minuto no processo de automações.",
  );
  revalidatePath("/app/manutencao");
  return r;
}

export async function togglePlanAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => setPlanActive(ctx, String(f.get("planId")), f.get("active") === "true"), "Plano atualizado.");
  revalidatePath("/app/manutencao");
  return r;
}

// ── Alertas e notificações ──
export async function ackAlertAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => acknowledgeAlert(ctx, String(f.get("alertId"))), "Alerta reconhecido (escalonamento suspenso).");
  revalidatePath("/app/alertas");
  return r;
}

export async function resolveAlertAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => resolveAlert(ctx, String(f.get("alertId")), s(f, "reason") ?? ""), "Alerta resolvido.");
  revalidatePath("/app/alertas");
  return r;
}

export async function updateRuleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const params = Object.fromEntries([...f.entries()].filter(([k]) => k.startsWith("param_")).map(([k, v]) => [k.slice(6), String(v).replace(",", ".")]));
  if (params.minAvailability) params.minAvailability = String(Number(params.minAvailability) / 100);
  const r = await toActionState(
    () => updateAlertRule(ctx, {
      ruleId: s(f, "ruleId"), enabled: f.get("enabled") === "on", severity: s(f, "severity"), params, cooldownMinutes: s(f, "cooldownMinutes"), escalateAfterMinutes: s(f, "escalateAfterMinutes"),
      createTicket: f.get("createTicket") === "on", ticketPriority: s(f, "ticketPriority"), notifyChannels: f.getAll("notifyChannels").map(String), includeNonProduction: f.get("includeNonProduction") === "on",
    }),
    "Regra atualizada.",
  );
  revalidatePath("/app/alertas");
  return r;
}

export async function runOperationsAction(_p: ActionState, _f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => runOperationsNow(ctx));
  revalidatePath("/app/alertas");
  if (r.status !== "ok" || !r.data) return r as ActionState;
  const { alerts, preventive, notifications } = r.data;
  const fmt = (x: { ok: boolean; stats?: unknown; error?: string }) => (x.ok ? JSON.stringify(x.stats) : `FALHOU: ${x.error}`);
  return { status: "ok", message: `Alertas: ${fmt(alerts)} · Preventiva: ${fmt(preventive)} · Notificações: ${fmt(notifications)}` };
}

export async function consentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const consent = f.get("consent") === "give";
  const r = await toActionState(() => setNotificationConsent(ctx, { channel: s(f, "channel"), destination: s(f, "destination") ?? "", consent }), consent ? "Consentimento registrado. Você pode revogá-lo a qualquer momento." : "Consentimento revogado.");
  revalidatePath("/app/conta");
  return r;
}
