import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createManualLead, listLeadsPage, moveLeadStage } from "@/server/modules/leads/service";
import { convertLeadToPartner, linkLeadToCompany, updateLeadDetails } from "@/server/modules/crm/details";
import { completeTask, createTask, listOpenTasks } from "@/server/modules/crm/tasks";
import { computeItems, createProposal, getProposal, reviseProposal, setProposalStatus } from "@/server/modules/crm/proposals";
import { createStage, updateStage } from "@/server/modules/crm/stages";
import { crmMetrics } from "@/server/modules/crm/metrics";
import { csvCell, exportLeadsCsv } from "@/server/modules/crm/export";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const future = () => new Date(Date.now() + 15 * 86400000);
const content = (over: Record<string, unknown> = {}) => ({
  title: "Eletroposto 2×60 kW",
  items: [{ description: "Implantação (taxa de franquia)", quantity: 1, unitPrice: 150000 }, { description: "Carregador DC 60 kW", quantity: 2, unitPrice: 0.335 }],
  validUntil: future(),
  conditions: "Condições conforme modelo Compra integral v1. Valores sujeitos a contrato.",
  ...over,
});

async function setup() {
  const op = await bootstrapOperator();
  const sales = await createUser(op.id, "commercial");
  const lead = await createManualLead(sales.ctx, { source: "MANUAL", contactName: "Ana", email: "ana@posto.com", companyName: "Posto Alfa" });
  const stages = await db.pipelineStage.findMany({ where: { organizationId: op.id }, orderBy: { position: "asc" } });
  const stage = (k: string) => stages.find((s) => s.key === k)!;
  return { op, sales, lead, stage };
}

describe("propostas", () => {
  it("arredonda itens e soma em Decimal (sem erro de ponto flutuante)", () => {
    expect(computeItems([{ description: "x", quantity: 3, unitPrice: 0.1 }]).total).toBe("0.30");
    expect(computeItems([{ description: "x", quantity: 2, unitPrice: 0.335 }]).rows[0].total).toBe("0.67");
  });

  it("numera, versiona sem sobrescrever e respeita transições", async () => {
    const { sales, lead } = await setup();
    const p = await createProposal(sales.ctx, { leadId: lead.id, ...content() });
    expect(p.number).toMatch(/^PROP-\d{4}-0001$/);
    await setProposalStatus(sales.ctx, { proposalId: p.id, status: "SENT" });
    await reviseProposal(sales.ctx, p.id, content({ items: [{ description: "Implantação", quantity: 1, unitPrice: 140000 }] }));
    const full = await getProposal(sales.ctx, p.id);
    expect(full.status).toBe("DRAFT"); // revisão de enviada exige reenvio
    expect(full.versions.map((v) => [v.version, v.total.toString()])).toEqual([["2", "140000"], ["1", "150000.67"]].map(([a, b]) => [Number(a), b]));
    await expect(setProposalStatus(sales.ctx, { proposalId: p.id, status: "ACCEPTED" })).rejects.toThrow(/Transição inválida/);
    await setProposalStatus(sales.ctx, { proposalId: p.id, status: "SENT" });
    await setProposalStatus(sales.ctx, { proposalId: p.id, status: "ACCEPTED" });
    await expect(reviseProposal(sales.ctx, p.id, content())).rejects.toThrow(/não podem ser revisadas/);
  });

  it("não envia proposta com validade vencida e rejeita validade passada", async () => {
    const { sales, lead } = await setup();
    await expect(createProposal(sales.ctx, { leadId: lead.id, ...content({ validUntil: new Date(Date.now() - 3 * 86400000) }) })).rejects.toThrow(/passado/);
    const p = await createProposal(sales.ctx, { leadId: lead.id, ...content() });
    await db.proposalVersion.updateMany({ where: { proposalId: p.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    await expect(setProposalStatus(sales.ctx, { proposalId: p.id, status: "SENT" })).rejects.toThrow(/expirou/);
  });

  it("numeração concorrente não colide", async () => {
    const { sales, lead } = await setup();
    const ps = await Promise.all([1, 2, 3].map(() => createProposal(sales.ctx, { leadId: lead.id, ...content() })));
    expect(new Set(ps.map((p) => p.number)).size).toBe(3);
  });

  it("outra organização não lê nem altera a proposta", async () => {
    const { sales, lead } = await setup();
    const p = await createProposal(sales.ctx, { leadId: lead.id, ...content() });
    const other = await createUser((await createOrg("Outra", "OPERATOR")).id, "admin");
    await expect(getProposal(other.ctx, p.id)).rejects.toThrow(/não encontrada/);
    await expect(setProposalStatus(other.ctx, { proposalId: p.id, status: "SENT" })).rejects.toThrow(/não encontrado/);
    await expect(createProposal(other.ctx, { leadId: lead.id, ...content() })).rejects.toThrow(/não encontrado/);
  });
});

describe("empresas e conversão", () => {
  it("reaproveita empresa por documento ou nome e não duplica contato", async () => {
    const { sales, lead } = await setup();
    const lead2 = await createManualLead(sales.ctx, { source: "MANUAL", contactName: "Bruno", email: "bruno@posto.com" });
    const c1 = await linkLeadToCompany(sales.ctx, { leadId: lead.id, name: "Posto Alfa Ltda", document: "12.345.678/0001-90" });
    const c2 = await linkLeadToCompany(sales.ctx, { leadId: lead2.id, name: "POSTO ALFA", document: "12345678000190" });
    const c3 = await linkLeadToCompany(sales.ctx, { leadId: lead.id, name: "Posto Alfa Ltda" });
    expect(new Set([c1.id, c2.id, c3.id]).size).toBe(1);
    expect(await db.contact.count({ where: { companyId: c1.id } })).toBe(2);
  });

  it("converte só lead ganho, uma única vez", async () => {
    const { sales, lead, stage } = await setup();
    await linkLeadToCompany(sales.ctx, { leadId: lead.id, name: "Posto Alfa", document: "12345678000190" });
    await expect(convertLeadToPartner(sales.ctx, { leadId: lead.id, kind: "PARTNER" })).rejects.toThrow(/ganho/);
    await moveLeadStage(sales.ctx, { leadId: lead.id, stageId: stage("ganho").id });
    const [a, b] = await Promise.all([
      convertLeadToPartner(sales.ctx, { leadId: lead.id, kind: "PARTNER" }),
      convertLeadToPartner(sales.ctx, { leadId: lead.id, kind: "PARTNER" }),
    ]);
    expect(a.organizationId).toBe(b.organizationId);
    expect(await db.organization.count({ where: { kind: "PARTNER" } })).toBe(1);
  });
});

describe("tarefas, qualificação e etapas", () => {
  it("cria e conclui tarefa; atrasadas aparecem em aberto", async () => {
    const { sales, lead } = await setup();
    const t = await createTask(sales.ctx, { leadId: lead.id, title: "Ligar para agendar visita", dueAt: new Date(Date.now() - 3600000) });
    expect((await listOpenTasks(sales.ctx, { mine: true })).map((x) => x.id)).toEqual([t.id]);
    await completeTask(sales.ctx, t.id);
    expect(await listOpenTasks(sales.ctx, { mine: true })).toHaveLength(0);
  });

  it("não atribui tarefa a usuário de outra organização", async () => {
    const { sales, lead } = await setup();
    const other = await createUser((await createOrg("Outra", "OPERATOR")).id, "commercial");
    await expect(createTask(sales.ctx, { leadId: lead.id, title: "xxx", dueAt: future(), assigneeId: other.user.id })).rejects.toThrow(/não pertence/);
  });

  it("valida qualificação e ordena/pagina a lista", async () => {
    const { sales, lead } = await setup();
    await expect(updateLeadDetails(sales.ctx, { leadId: lead.id, priority: "URGENTE" })).rejects.toThrow();
    await updateLeadDetails(sales.ctx, { leadId: lead.id, priority: "HIGH", estimatedValue: 150000, expectedCloseDate: future() });
    for (let i = 0; i < 26; i++) await createManualLead(sales.ctx, { source: "MANUAL", contactName: `L${i}`, email: `l${i}@x.com` });
    const p1 = await listLeadsPage(sales.ctx, { page: 1, sort: "estimatedValue", dir: "desc" });
    expect(p1.total).toBe(27);
    expect(p1.pages).toBe(2);
    expect(p1.items[0].id).toBe(lead.id);
    expect((await listLeadsPage(sales.ctx, { page: 2 })).items).toHaveLength(2);
  });

  it("configuração do funil exige permissão e protege etapas finais", async () => {
    const { op, sales, stage } = await setup();
    await expect(updateStage(sales.ctx, { stageId: stage("novo").id, name: "Entrada", probabilityPct: 5 })).rejects.toThrow(/permissão/);
    const admin = await createUser(op.id, "admin");
    await expect(updateStage(admin.ctx, { stageId: stage("ganho").id, name: "Ganho", probabilityPct: 80 })).rejects.toThrow(/100%/);
    const s = await createStage(admin.ctx, { name: "Aprovação jurídica", probabilityPct: 85 });
    const order = await db.pipelineStage.findMany({ where: { organizationId: op.id }, orderBy: { position: "asc" } });
    expect(order.map((x) => x.id).indexOf(s.id)).toBe(order.findIndex((x) => x.isWon) - 1);
  });
});

describe("métricas e exportação", () => {
  it("calcula conversão, taxa de ganho e pipeline ponderado conforme as fórmulas", async () => {
    const { sales, lead, stage } = await setup();
    const l2 = await createManualLead(sales.ctx, { source: "REFERRAL", contactName: "Beto", email: "b@x.com" });
    await updateLeadDetails(sales.ctx, { leadId: l2.id, priority: "MEDIUM", estimatedValue: 100000 });
    await moveLeadStage(sales.ctx, { leadId: l2.id, stageId: stage("proposta").id }); // 50%
    await moveLeadStage(sales.ctx, { leadId: lead.id, stageId: stage("qualificacao").id });
    await moveLeadStage(sales.ctx, { leadId: lead.id, stageId: stage("perdido").id, lostReason: "Sem espaço" });
    const m = await crmMetrics(sales.ctx, { from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 60000) });
    expect(m.leadsCreated).toBe(2);
    const reach = Object.fromEntries(m.reachByStage.map((r) => [r.name, r.reached]));
    expect(reach["Novo lead"]).toBe(2);
    expect(reach["Qualificação"]).toBe(2); // l2 pulou etapas: conta como alcançado
    expect(reach["Proposta enviada"]).toBe(1);
    expect(m.winRate).toBe(0); // 0 ganhos ÷ 1 encerrado
    expect(m.weightedPipeline.value).toBe("50000.00");
    expect(m.leadsBySource).toEqual(expect.arrayContaining([{ source: "MANUAL", count: 1 }, { source: "REFERRAL", count: 1 }]));
  });

  it("exportação exige permissão, neutraliza fórmulas e é auditada", async () => {
    const { op, sales } = await setup();
    await expect(exportLeadsCsv(sales.ctx)).rejects.toThrow(/permissão/);
    await createManualLead(sales.ctx, { source: "MANUAL", contactName: "=HYPERLINK(\"x\")", email: "f@x.com" });
    const admin = await createUser(op.id, "admin");
    const csv = await exportLeadsCsv(admin.ctx);
    expect(csv.rows).toBe(2);
    expect(csv.content).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(await db.auditEvent.count({ where: { action: "lead.exported" } })).toBe(1);
  });
});
