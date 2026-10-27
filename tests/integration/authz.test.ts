import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resolveSession, login, logout } from "@/server/auth/session";
import { listLeads, getLead, moveLeadStage, submitPublicLead, createManualLead } from "@/server/modules/leads/service";
import { listSites, getSite } from "@/server/modules/sites/service";
import { listModels, approveVersion } from "@/server/modules/commercial/service";
import { revokeMembership } from "@/server/modules/identity/service";
import { bootstrapOperator, createOrg, createUser, resetDb, PASSWORD } from "./fixtures";

const okLead = (over: Record<string, unknown> = {}) => ({
  source: "WEBSITE_VIABILITY",
  contactName: "Maria Teste",
  email: "maria@exemplo.com.br",
  phone: "(91) 99999-0000",
  consent: true,
  ...over,
});
const human = { formStartedAt: Date.now() - 10_000 };

beforeEach(async () => {
  await resetDb();
});

describe("autenticação e sessões", () => {
  it("rejeita senha errada com mensagem genérica", async () => {
    const op = await bootstrapOperator();
    const { user } = await createUser(op.id, "commercial");
    await expect(login({ email: user.email, password: "errada-123456" })).rejects.toThrow("E-mail ou senha inválidos.");
    await expect(login({ email: "naoexiste@x.com", password: "qualquer-123" })).rejects.toThrow("E-mail ou senha inválidos.");
  });

  it("logout revoga o token", async () => {
    const op = await bootstrapOperator();
    const { token } = await createUser(op.id, "commercial");
    expect(await resolveSession(token)).not.toBeNull();
    await logout(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("usuário perde acesso imediatamente após revogação do vínculo", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const victim = await createUser(op.id, "commercial");
    expect(await resolveSession(victim.token)).not.toBeNull();
    await revokeMembership(admin.ctx, victim.membership.id);
    expect(await resolveSession(victim.token)).toBeNull();
    await expect(login({ email: victim.user.email, password: PASSWORD })).rejects.toThrow();
  });

  it("perfil sem permissão não revoga vínculos", async () => {
    const op = await bootstrapOperator();
    const sales = await createUser(op.id, "commercial");
    const other = await createUser(op.id, "commercial");
    await expect(revokeMembership(sales.ctx, other.membership.id)).rejects.toThrow(/permissão/);
  });
});

describe("isolamento entre organizações", () => {
  it("usuário de outra organização não lê leads da operadora", async () => {
    const op = await bootstrapOperator();
    const { leadId } = await submitPublicLead(okLead(), human);
    const otherOrg = await createOrg("Outra Operadora", "OPERATOR");
    const intruder = await createUser(otherOrg.id, "admin");
    expect(await listLeads(intruder.ctx)).toHaveLength(0);
    await expect(getLead(intruder.ctx, leadId!)).rejects.toThrow(/não encontrado/);
    const intruderStages = await db.pipelineStage.findMany({ where: { organizationId: op.id } });
    await expect(moveLeadStage(intruder.ctx, { leadId, stageId: intruderStages[1].id })).rejects.toThrow(/não encontrado/);
  });

  it("parceiro vê somente as próprias unidades", async () => {
    const op = await bootstrapOperator();
    const p1 = await createOrg("Parceiro A", "PARTNER");
    const p2 = await createOrg("Parceiro B", "PARTNER");
    const s1 = await db.site.create({ data: { operatorId: op.id, partnerOrganizationId: p1.id, name: "Unidade A" } });
    const s2 = await db.site.create({ data: { operatorId: op.id, partnerOrganizationId: p2.id, name: "Unidade B" } });
    const partnerA = await createUser(p1.id, "partner");
    const sites = await listSites(partnerA.ctx);
    expect(sites.map((s) => s.id)).toEqual([s1.id]);
    await expect(getSite(partnerA.ctx, s2.id)).rejects.toThrow(/não encontrada/);
    const opAdmin = await createUser(op.id, "admin");
    expect((await listSites(opAdmin.ctx)).length).toBe(2);
  });

  it("parceiro não acessa CRM nem modelos comerciais internos", async () => {
    await bootstrapOperator();
    const p = await createOrg("Parceiro", "PARTNER");
    const partner = await createUser(p.id, "partner");
    await expect(listLeads(partner.ctx)).rejects.toThrow(/permissão/);
    await expect(listModels(partner.ctx)).rejects.toThrow(/permissão/);
  });

  it("requisição sem sessão é recusada", async () => {
    await expect(listLeads(null)).rejects.toThrow(/Sessão/);
  });

  it("perfil comercial não aprova versão de modelo", async () => {
    const op = await bootstrapOperator();
    const sales = await createUser(op.id, "commercial");
    const v = await db.commercialModelVersion.findFirstOrThrow();
    await expect(approveVersion(sales.ctx, v.id)).rejects.toThrow(/permissão/);
  });
});

describe("captação pública de leads", () => {
  it("persiste lead válido no primeiro estágio com consentimento", async () => {
    await bootstrapOperator();
    const r = await submitPublicLead(okLead(), human);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId! }, include: { stage: true } });
    expect(lead.stage.key).toBe("novo");
    expect(lead.phoneNormalized).toBe("91999990000");
    expect(lead.consentAt).not.toBeNull();
  });

  it("formulário inválido não persiste dados", async () => {
    await bootstrapOperator();
    await expect(submitPublicLead(okLead({ email: "invalido" }), human)).rejects.toThrow();
    await expect(submitPublicLead(okLead({ consent: false }), human)).rejects.toThrow();
    await expect(submitPublicLead(okLead({ state: "XX" }), human)).rejects.toThrow();
    expect(await db.lead.count()).toBe(0);
  });

  it("descarta robôs (honeypot e envio rápido demais) sem persistir", async () => {
    await bootstrapOperator();
    expect(await submitPublicLead(okLead(), { ...human, honeypot: "http://spam" })).toMatchObject({ discarded: true });
    expect(await submitPublicLead(okLead(), { formStartedAt: Date.now() })).toMatchObject({ discarded: true });
    expect(await db.lead.count()).toBe(0);
  });

  it("reenvio do mesmo contato não duplica lead em aberto (inclusive concorrente)", async () => {
    await bootstrapOperator();
    const results = await Promise.all([
      submitPublicLead(okLead(), human),
      submitPublicLead(okLead({ email: "MARIA@exemplo.com.br" }), human),
      submitPublicLead(okLead({ email: "outro@exemplo.com.br" }), human), // mesmo telefone
    ]);
    expect(await db.lead.count()).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(2);
    expect(await db.leadActivity.count({ where: { kind: "DUPLICATE_SUBMISSION" } })).toBe(2);
  });

  it("limita envios por IP", async () => {
    await bootstrapOperator();
    for (let i = 0; i < 5; i++) await submitPublicLead(okLead({ email: `x${i}@ex.com`, phone: undefined }), { ...human, ip: "10.0.0.1" });
    await expect(submitPublicLead(okLead({ email: "y@ex.com", phone: undefined }), { ...human, ip: "10.0.0.1" })).rejects.toThrow(/muitas/);
  });
});

describe("funil comercial", () => {
  it("exige motivo de perda e registra histórico de estágio", async () => {
    const op = await bootstrapOperator();
    const sales = await createUser(op.id, "commercial");
    const lead = await createManualLead(sales.ctx, { source: "MANUAL", contactName: "Posto Exemplo", email: "posto@ex.com" });
    const lost = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: op.id, isLost: true } });
    await expect(moveLeadStage(sales.ctx, { leadId: lead.id, stageId: lost.id })).rejects.toThrow(/motivo/);
    await moveLeadStage(sales.ctx, { leadId: lead.id, stageId: lost.id, lostReason: "Sem infraestrutura elétrica" });
    const full = await getLead(sales.ctx, lead.id);
    expect(full.lostReason).toBe("Sem infraestrutura elétrica");
    expect(full.activities.some((a) => a.kind === "STAGE_CHANGE")).toBe(true);
    expect(await db.auditEvent.count({ where: { action: "lead.stage_changed" } })).toBe(1);
  });
});
