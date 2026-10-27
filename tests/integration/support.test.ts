import { beforeEach, describe, expect, it } from "vitest";
import type { NotificationChannel } from "@prisma/client";
import { db } from "@/server/db";
import { ensureOperationsDefaults } from "@/server/bootstrap";
import { createSite, createStation, upsertConnector } from "@/server/modules/stations/service";
import { addTicketComment, changeTicketStatus, createTicket, getTicket, importDriverSupportRequests, listTickets, saveSlaPolicy } from "@/server/modules/support/tickets";
import { addPart, completeWorkOrder, createPlan, createWorkOrder, runPreventive, setChecklist } from "@/server/modules/maintenance/service";
import { addAttachment } from "@/server/modules/attachments/service";
import { acknowledgeAlert, evaluateAlerts, listAlerts, resolveAlert } from "@/server/modules/alerts/engine";
import { updateAlertRule } from "@/server/modules/alerts/rules";
import { dispatchNotifications, setNotificationConsent } from "@/server/modules/alerts/notifications";
import { runJob } from "@/server/modules/automation/runner";
import { opsPanel } from "@/server/modules/support/panel";
import type { ChannelAdapter } from "@/server/integrations/notify";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
let seq = 0;

async function setup() {
  const op = await bootstrapOperator();
  await ensureOperationsDefaults(db, op.id);
  const admin = await createUser(op.id, "admin");
  const ops = await createUser(op.id, "operations");
  const support = await createUser(op.id, "support");
  const partnerOrg = await createOrg("Parceiro", "PARTNER");
  const partner = await createUser(partnerOrg.id, "partner");
  const site = await createSite(admin.ctx, { name: "Posto Norte", partnerOrganizationId: partnerOrg.id });
  const station = (await createStation(admin.ctx, { siteId: site.id, ocppIdentity: `CP-S-${++seq}`, environment: "PRODUCTION", heartbeatInterval: 60 })).station;
  await upsertConnector(admin.ctx, { stationId: station.id, connectorId: 1, type: "CCS2", maxPowerKw: 60 });
  return { op, admin, ops, support, partner, site, station };
}

const adapters = (send: ChannelAdapter["send"]): Record<NotificationChannel, ChannelAdapter> => ({
  EMAIL: { channel: "EMAIL", name: "fake", status: "configured", send },
  SMS: { channel: "SMS", name: "nenhum", status: "not_configured", send: async () => ({ delivered: false }) },
  WHATSAPP: { channel: "WHATSAPP", name: "nenhum", status: "not_configured", send: async () => ({ delivered: false }) },
});

describe("tickets e SLA", () => {
  it("SLA copiado na criação; pausa exige motivo e é registrada; transições validadas; histórico", async () => {
    const s = await setup();
    const t = await createTicket(s.support.ctx, { title: "Conector não trava", description: "Motorista relata falha ao travar.", category: "CHARGER_FAULT", priority: "HIGH", stationId: s.station.id });
    expect(t).toMatchObject({ number: expect.stringMatching(/^TCK-\d{4}-00001$/), slaResponseMinutes: 60, slaResolutionMinutes: 480, siteId: s.site.id });
    await saveSlaPolicy(s.ops.ctx, { priority: "HIGH", responseMinutes: 10, resolutionMinutes: 20 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).slaResolutionMinutes).toBe(480); // não retroage

    await expect(changeTicketStatus(s.support.ctx, { ticketId: t.id, status: "WAITING_THIRD_PARTY" })).rejects.toThrow(/motivo/);
    await changeTicketStatus(s.support.ctx, { ticketId: t.id, status: "WAITING_THIRD_PARTY", reason: "Aguardando peça do fabricante" });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).pausedSince).not.toBeNull();
    await changeTicketStatus(s.support.ctx, { ticketId: t.id, status: "IN_PROGRESS" });
    await expect(changeTicketStatus(s.support.ctx, { ticketId: t.id, status: "CLOSED" })).rejects.toThrow(/Transição inválida/);
    await changeTicketStatus(s.support.ctx, { ticketId: t.id, status: "RESOLVED", reason: "Trava substituída." });
    const d = await getTicket(s.support.ctx, t.id);
    expect(d.events.map((e) => e.kind)).toEqual(["CREATED", "PAUSE", "STATUS_CHANGE", "RESUME", "STATUS_CHANGE", "STATUS_CHANGE"]);
    expect(d.sla.pauses).toHaveLength(1);
    expect(d.sla.pauses[0].to).not.toBeNull();
    expect(d.sla.resolution.state).toBe("MET");
    expect(d.firstResponseAt).not.toBeNull();
  });

  it("primeira resposta por comentário; permissões; isolamento entre operadoras", async () => {
    const s = await setup();
    const t = await createTicket(s.support.ctx, { title: "Dúvida", description: "Motorista pergunta sobre tarifa.", category: "DRIVER_SUPPORT", priority: "LOW" });
    await addTicketComment(s.support.ctx, { ticketId: t.id, body: "Respondido por telefone." });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).firstResponseAt).not.toBeNull();
    await expect(listTickets(s.partner.ctx)).rejects.toThrow(/permissão/);
    await expect(saveSlaPolicy(s.support.ctx, { priority: "LOW", responseMinutes: 1, resolutionMinutes: 2 })).rejects.toThrow(/permissão/);
    const op2 = await createOrg("Outra Operadora", "OPERATOR");
    const intruder = await createUser(op2.id, "admin");
    await expect(getTicket(intruder.ctx, t.id)).rejects.toThrow(/não encontrado/);
    await expect(createTicket(intruder.ctx, { title: "x x x", description: "tentativa", category: "OTHER", priority: "LOW", stationId: s.station.id })).rejects.toThrow(/não encontrada/);
  });

  it("solicitação do motorista vira ticket uma única vez", async () => {
    const s = await setup();
    const driver = await db.driver.create({ data: { email: "m@ex.com", name: "M", passwordHash: "x", consentAt: new Date(), consentVer: "1" } });
    await db.supportRequest.create({ data: { driverId: driver.id, subject: "Cobrança", message: "Fui cobrado duas vezes." } });
    expect(await importDriverSupportRequests(s.op.id)).toBe(1);
    expect(await importDriverSupportRequests(s.op.id)).toBe(0);
    expect(await db.ticket.count({ where: { origin: "DRIVER" } })).toBe(1);
  });
});

describe("ordens de serviço e preventiva", () => {
  it("conclusão exige checklist e evidência; custo vira despesa de manutenção", async () => {
    const s = await setup();
    const t = await createTicket(s.support.ctx, { title: "Falha", description: "Conector em falha.", category: "CHARGER_FAULT", priority: "HIGH", stationId: s.station.id });
    const wo = await createWorkOrder(s.support.ctx, { stationId: s.station.id, title: "Trocar trava", ticketId: t.id, checklist: ["Desenergizar", "Trocar trava", "Teste funcional"] });
    expect(wo.number).toMatch(/^OS-\d{4}-00001$/);
    await addPart(s.support.ctx, { workOrderId: wo.id, description: "Trava CCS2", quantity: 2, unitCost: 125.555 });
    await expect(completeWorkOrder(s.support.ctx, { workOrderId: wo.id, completionNotes: "Serviço executado conforme checklist.", laborCost: 200 })).rejects.toThrow(/Checklist incompleto/);
    await setChecklist(s.support.ctx, { workOrderId: wo.id, items: [{ item: "Desenergizar", done: true }, { item: "Trocar trava", done: true }, { item: "Teste funcional", done: true }] });
    await expect(completeWorkOrder(s.support.ctx, { workOrderId: wo.id, completionNotes: "Serviço executado conforme checklist.", laborCost: 200 })).rejects.toThrow(/evidência/);
    await addAttachment(s.support.ctx, { entityType: "WorkOrder", entityId: wo.id, filename: "foto.jpg", bytes: JPEG });
    await completeWorkOrder(s.support.ctx, { workOrderId: wo.id, completionNotes: "Serviço executado conforme checklist.", laborCost: 200 });
    const entry = await db.financialEntry.findUniqueOrThrow({ where: { workOrderId: wo.id } });
    // peças: 2 × 125,56 = 251,12 + mão de obra 200 = 451,12
    expect(entry).toMatchObject({ kind: "PAYABLE", category: "MAINTENANCE", source: "WORK_ORDER", siteId: s.site.id });
    expect(entry.amount.toString()).toBe("451.12");
    expect((await getTicket(s.support.ctx, t.id)).events.filter((e) => e.kind === "WORK_ORDER")).toHaveLength(2);
    await expect(addPart(s.support.ctx, { workOrderId: wo.id, description: "Parafuso", quantity: 1, unitCost: 1 })).rejects.toThrow(/concluída/);
  });

  it("preventiva por tempo gera uma única OS por plano; por uso sem telemetria confiável não gera", async () => {
    const s = await setup();
    const p = await createPlan(s.ops.ctx, { stationId: s.station.id, name: "Inspeção mensal", trigger: "TIME", intervalDays: 30, checklist: ["Limpeza", "Reaperto"] });
    expect(await runPreventive(s.op.id)).toBe(0);
    await db.maintenancePlan.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
    const [a, b] = await Promise.all([runPreventive(s.op.id), runPreventive(s.op.id)]);
    expect(a + b).toBe(1);
    expect(await runPreventive(s.op.id)).toBe(0);
    const wo = await db.workOrder.findFirstOrThrow({ where: { planId: p.id } });
    expect(wo).toMatchObject({ type: "PREVENTIVE", checklist: [{ item: "Limpeza", done: false }, { item: "Reaperto", done: false }] });

    const test = (await createStation(s.admin.ctx, { siteId: s.site.id, ocppIdentity: `CP-T-${++seq}`, environment: "TEST" })).station;
    const p2 = await createPlan(s.ops.ctx, { stationId: test.id, name: "Por energia", trigger: "ENERGY_KWH", intervalKwh: 1, checklist: ["Inspeção"] });
    await db.chargingSession.create({ data: { stationId: test.id, connectorId: 1, transactionId: 1, idTag: "T", environment: "TEST", meterStartWh: 0, meterStopWh: 50000, startedAt: new Date(), stoppedAt: new Date(), status: "COMPLETED" } });
    expect(await runPreventive(s.op.id)).toBe(0);
    expect(await db.workOrder.count({ where: { planId: p2.id } })).toBe(0);
  });
});

describe("alertas, deduplicação, escalonamento e notificações", () => {
  async function offline(stationId: string, minutesAgo: number) {
    await db.chargingStation.update({ where: { id: stationId }, data: { connectionState: "DISCONNECTED", lastSeenAt: new Date(Date.now() - minutesAgo * 60_000) } });
  }

  it("carregador offline: um alerta + ticket; reavaliação não duplica; volta → resolve; reaparece no cooldown → reabre sem novo ticket", async () => {
    const s = await setup();
    await offline(s.station.id, 60);
    const [r1, r2] = await Promise.all([evaluateAlerts(s.op.id), evaluateAlerts(s.op.id)]);
    expect(r1.created + r2.created).toBe(1);
    expect(await db.alert.count()).toBe(1); // offline não gera também "queda de disponibilidade"
    expect(await db.ticket.count({ where: { origin: "ALERT" } })).toBe(1);
    await evaluateAlerts(s.op.id);
    expect(await db.alert.count()).toBe(1);

    await db.chargingStation.update({ where: { id: s.station.id }, data: { connectionState: "CONNECTED", lastSeenAt: new Date() } });
    expect((await evaluateAlerts(s.op.id)).resolved).toBe(1);
    await offline(s.station.id, 60);
    expect((await evaluateAlerts(s.op.id)).reopened).toBe(1);
    const alerts = await db.alert.findMany({ where: { kind: "STATION_OFFLINE" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: "OPEN", occurrences: 2 });
    expect(await db.ticket.count({ where: { origin: "ALERT" } })).toBe(1);
  });

  it("dados de teste/simulação não geram alerta por padrão; falhas repetidas e sessão interrompida", async () => {
    const s = await setup();
    const sim = (await createStation(s.admin.ctx, { siteId: s.site.id, ocppIdentity: `CP-SIM-${++seq}`, environment: "SIMULATED" })).station;
    await offline(sim.id, 120);
    expect((await evaluateAlerts(s.op.id)).created).toBe(0);

    const conn = await db.connector.findFirstOrThrow({ where: { stationId: s.station.id } });
    await db.connectorStatusEvent.createMany({ data: [1, 2, 3].map((i) => ({ connectorPk: conn.id, status: "FAULTED" as const, applied: true, receivedAt: new Date(Date.now() - i * 60_000) })) });
    await db.chargingStation.update({ where: { id: s.station.id }, data: { connectionState: "CONNECTED", lastSeenAt: new Date() } });
    await db.chargingSession.create({ data: { stationId: s.station.id, connectorId: 1, transactionId: 7, idTag: "X", environment: "PRODUCTION", meterStartWh: 0, meterStopWh: 100, startedAt: new Date(Date.now() - 600_000), stoppedAt: new Date(), stopReason: "PowerLoss", status: "COMPLETED" } });
    await evaluateAlerts(s.op.id);
    const kinds = (await db.alert.findMany()).map((a) => a.kind).sort();
    expect(kinds).toEqual(["AVAILABILITY_DROP", "REPEATED_FAULTS", "SESSION_INTERRUPTED"]);
    const interrupted = (await listAlerts(s.ops.ctx)).find((a) => a.kind === "SESSION_INTERRUPTED")!;
    await acknowledgeAlert(s.ops.ctx, interrupted.id);
    await resolveAlert(s.ops.ctx, interrupted.id, "Queda de energia da concessionária confirmada.");
    await evaluateAlerts(s.op.id);
    expect(await db.alert.count({ where: { kind: "SESSION_INTERRUPTED" } })).toBe(1); // tratada manualmente: não recria
  });

  it("escalonamento ocorre uma única vez e eleva o ticket", async () => {
    const s = await setup();
    await offline(s.station.id, 60);
    await evaluateAlerts(s.op.id);
    await db.alert.updateMany({ data: { firstSeenAt: new Date(Date.now() - 2 * 3600_000) } });
    expect((await evaluateAlerts(s.op.id)).escalated).toBe(1);
    expect((await evaluateAlerts(s.op.id)).escalated).toBe(0);
    expect((await db.ticket.findFirstOrThrow({ where: { origin: "ALERT" } })).priority).toBe("CRITICAL");
  });

  it("notificações: canal não configurado e sem consentimento ficam registrados; retentativa com limite; sem duplicidade nem laço", async () => {
    const s = await setup();
    const rule = await db.alertRule.findFirstOrThrow({ where: { operatorId: s.op.id, kind: "STATION_OFFLINE" } });
    const upd = { ruleId: rule.id, enabled: true, severity: "CRITICAL", params: { minutes: 10 }, cooldownMinutes: 60, createTicket: false, ticketPriority: "HIGH", includeNonProduction: false };
    await expect(updateAlertRule(s.support.ctx, { ...upd, notifyChannels: ["EMAIL"] })).rejects.toThrow(/permissão/);
    await updateAlertRule(s.ops.ctx, { ...upd, notifyChannels: ["EMAIL", "SMS"] });

    await offline(s.station.id, 60);
    await evaluateAlerts(s.op.id); // adaptadores padrão: nenhum configurado
    expect((await db.notification.findMany()).map((n) => [n.channel, n.status]).sort()).toEqual([["EMAIL", "SKIPPED_NOT_CONFIGURED"], ["SMS", "SKIPPED_NOT_CONFIGURED"]]);

    await db.alert.deleteMany();
    await db.notification.deleteMany();
    const failing = adapters(async () => { throw new Error("SMTP indisponível"); });
    await evaluateAlerts(s.op.id, new Date(), failing); // e-mail "configurado", mas ninguém consentiu
    expect((await db.notification.findFirstOrThrow({ where: { channel: "EMAIL" } })).status).toBe("SKIPPED_NO_CONSENT");

    await db.alert.deleteMany();
    await db.notification.deleteMany();
    await setNotificationConsent(s.ops.ctx, { channel: "EMAIL", destination: "ops@sansolmob.local", consent: true });
    await setNotificationConsent(s.partner.ctx, { channel: "EMAIL", destination: "p@ex.com", consent: true }).catch(() => undefined);
    await evaluateAlerts(s.op.id, new Date(), failing);
    const pending = await db.notification.findMany({ where: { channel: "EMAIL" } });
    expect(pending.map((n) => [n.status, n.recipientUserId])).toEqual([["PENDING", s.ops.user.id]]);
    let now = new Date();
    for (let i = 1; i <= 5; i++) {
      await dispatchNotifications(now, failing);
      now = new Date(now.getTime() + 60 * 60_000);
    }
    const failed = await db.notification.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 5, lastError: "SMTP indisponível" });
    expect(await db.alert.count()).toBe(1); // falha de notificação não gera alerta

    await db.notification.update({ where: { id: failed.id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: null } });
    const sent: string[] = [];
    const ok = adapters(async (m) => { sent.push(m.to); return { delivered: true }; });
    await dispatchNotifications(new Date(), ok);
    await dispatchNotifications(new Date(Date.now() + 3600_000), ok);
    await evaluateAlerts(s.op.id, new Date(), ok); // reavaliação do mesmo alerta não reenfileira
    expect(sent).toEqual(["ops@sansolmob.local"]);
    expect(await db.notification.count({ where: { channel: "EMAIL" } })).toBe(1);
  });

  it("execução de automação registra sucesso, falha e número da tentativa", async () => {
    const s = await setup();
    await runJob("teste", s.op.id, async () => { throw new Error("banco indisponível"); });
    await runJob("teste", s.op.id, async () => { throw new Error("banco indisponível"); });
    await runJob("teste", s.op.id, async () => ({ ok: 1 }));
    await runJob("teste", s.op.id, async () => { throw new Error("de novo"); });
    const runs = await db.automationRun.findMany({ where: { job: "teste" }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => [r.status, r.attempt])).toEqual([["FAILED", 1], ["FAILED", 2], ["SUCCEEDED", 3], ["FAILED", 1]]);
    expect(runs[0].error).toBe("banco indisponível");
  });
});

describe("painel operacional", () => {
  it("MTTR e cumprimento de SLA com fórmulas explícitas", async () => {
    const s = await setup();
    const from = new Date(Date.now() - 7 * 86400_000);
    const mk = async (createdH: number, resolvedH: number) => {
      const t = await createTicket(s.support.ctx, { title: "Falha", description: "Falha no carregador.", category: "CHARGER_FAULT", priority: "HIGH", stationId: s.station.id });
      const base = Date.now() - 48 * 3600_000;
      await db.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED", createdAt: new Date(base + createdH * 3600_000), firstResponseAt: new Date(base + createdH * 3600_000 + 60_000), resolvedAt: new Date(base + resolvedH * 3600_000) } });
    };
    await mk(0, 4); // 4 h ≤ 8 h → cumprido
    await mk(0, 10); // 10 h > 8 h → estourado
    const p = await opsPanel(s.ops.ctx, { from, to: new Date() });
    expect(p.mttrHours).toBeCloseTo(7, 5);
    expect(p.slaCompliance).toBe(0.5);
    expect(p.responseCompliance).toBe(1);
    await expect(opsPanel(s.partner.ctx, { from, to: new Date() })).rejects.toThrow(/permissão/);
  });
});
