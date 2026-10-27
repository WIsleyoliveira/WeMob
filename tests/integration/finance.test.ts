import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSite, createStation } from "@/server/modules/stations/service";
import { createAmendment, createContract, decideContractVersion, getContract } from "@/server/modules/contracts/service";
import { cancelEntry, createAdjustment, createEntry, createTaxRule, listEntries, settleEntry } from "@/server/modules/finance/entries";
import { approveClosing, computeClosing, getClosing, previewClosing, rejectClosing, requestClosing } from "@/server/modules/finance/closing";
import { exportStatementCsv, getStatement } from "@/server/modules/finance/statement";
import { initiatePayout } from "@/server/modules/finance/payouts";
import { exportPartnerStatementCsv, partnerContracts, partnerStatements } from "@/server/modules/partner/portal";
import { addAttachment, getAttachmentForDownload } from "@/server/modules/attachments/service";
import { periodOf } from "@/domain/finance/period";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const PERIOD = "2026-09";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0x0a]);
let seq = 0;

const terms50 = (o: Record<string, unknown> = {}) => ({
  effectiveFrom: "2026-01-01T00:00:00-03:00", royaltyRate: 0.08, royaltyBase: "NET_REVENUE", platformFeeRate: 0.1,
  partnerShareRate: 0.5, partnerShareBase: "OPERATING_RESULT", lossTreatment: "SHARE_MONTHLY", paymentTermDays: 10,
  conditions: "Partilha 50/50 do resultado operacional mensal.", reason: "Contrato original assinado.", ...o,
});

async function setup() {
  const op = await bootstrapOperator();
  const a = await createUser(op.id, "admin");
  const b = await createUser(op.id, "admin");
  const fin = await createUser(op.id, "finance");
  const commercial = await createUser(op.id, "commercial");
  const p1 = await createOrg("Parceiro Um", "PARTNER");
  const p2 = await createOrg("Parceiro Dois", "PARTNER");
  const partner1 = await createUser(p1.id, "partner");
  const partner2 = await createUser(p2.id, "partner");
  const site1 = await createSite(a.ctx, { name: "Posto Um", partnerOrganizationId: p1.id });
  const site2 = await createSite(a.ctx, { name: "Posto Dois", partnerOrganizationId: p2.id });
  const st1 = (await createStation(a.ctx, { siteId: site1.id, ocppIdentity: `CP-F-${++seq}`, environment: "PRODUCTION" })).station;
  const st2 = (await createStation(a.ctx, { siteId: site2.id, ocppIdentity: `CP-F-${++seq}`, environment: "PRODUCTION" })).station;
  return { op, a, b, fin, commercial, p1, p2, partner1, partner2, site1, site2, st1, st2 };
}

/** Receita de produção: sessão encerrada no período + pagamento capturado (dado de teste direto no banco). */
async function revenue(stationId: string, captured: string, refunded = "0", stoppedAt = "2026-09-15T12:00:00-03:00") {
  const driver = await db.driver.create({ data: { email: `m${++seq}@ex.com`, name: "M", passwordHash: "x", consentAt: new Date(), consentVer: "1" } });
  const session = await db.chargingSession.create({
    data: { stationId, connectorId: 1, transactionId: ++seq, idTag: `T${seq}`, environment: "PRODUCTION", meterStartWh: 0, meterStopWh: 10000, startedAt: new Date(new Date(stoppedAt).getTime() - 3600_000), stoppedAt: new Date(stoppedAt), status: "COMPLETED", driverId: driver.id, amount: captured },
  });
  return db.payment.create({ data: { driverId: driver.id, sessionId: session.id, provider: "real-teste", environment: "PRODUCTION", providerRef: `ref-${seq}`, status: Number(refunded) > 0 ? "PARTIALLY_REFUNDED" : "CAPTURED", amountAuthorized: captured, amountCaptured: captured, amountRefunded: refunded, reconciledAt: new Date() } });
}

async function contractFor(s: Awaited<ReturnType<typeof setup>>, partnerId: string, siteId: string, o: Record<string, unknown> = {}) {
  const c = await createContract(s.a.ctx, { contract: { partnerOrganizationId: partnerId, title: "Contrato de operação", siteIds: [siteId] }, terms: terms50(o) });
  const v = await db.contractVersion.findFirstOrThrow({ where: { contractId: c.id } });
  await decideContractVersion(s.b.ctx, v.id, { approve: true });
  return c;
}

async function standardData(s: Awaited<ReturnType<typeof setup>>) {
  await createTaxRule(s.b.ctx, { name: "Simples Nacional", rate: 0.06, effectiveFrom: "2026-01-01T00:00:00-03:00" });
  const c1 = await contractFor(s, s.p1.id, s.site1.id);
  const c2 = await contractFor(s, s.p2.id, s.site2.id);
  await revenue(s.st1.id, "1000.00");
  await revenue(s.st2.id, "400.00", "100.00");
  await createEntry(s.fin.ctx, { category: "ENERGY", description: "Conta de energia setembro", amount: 300, competence: PERIOD, siteId: s.site1.id });
  return { c1, c2 };
}

describe("contratos", () => {
  it("versões imutáveis, aditivo preserva a anterior, quatro olhos e vigência", async () => {
    const s = await setup();
    const c = await createContract(s.a.ctx, { contract: { partnerOrganizationId: s.p1.id, title: "Contrato 50/50", siteIds: [s.site1.id] }, terms: terms50() });
    expect(c.number).toMatch(/^CTR-\d{4}-0001$/);
    const v1 = await db.contractVersion.findFirstOrThrow({ where: { contractId: c.id } });
    await expect(decideContractVersion(s.a.ctx, v1.id, { approve: true })).rejects.toThrow(/diferente de quem criou/);
    await expect(decideContractVersion(s.b.ctx, v1.id, { approve: false })).rejects.toThrow(/motivo da recusa/);
    await decideContractVersion(s.b.ctx, v1.id, { approve: true });
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");
    await expect(decideContractVersion(s.fin.ctx, v1.id, { approve: true })).rejects.toThrow(/rascunho/);

    const future = new Date(Date.now() + 40 * 86400_000).toISOString();
    const v2 = await createAmendment(s.a.ctx, c.id, terms50({ partnerShareRate: 0.6, effectiveFrom: future, reason: "Aditivo 1: participação 60%." }));
    await expect(createAmendment(s.a.ctx, c.id, terms50({ reason: "Outro aditivo" }))).rejects.toThrow(/rascunho aguardando/);
    await decideContractVersion(s.fin.ctx, v2.id, { approve: true });
    const detail = await getContract(s.fin.ctx, c.id);
    expect(detail.versions.map((v) => [v.version, v.kind, v.status, v.partnerShareRate.toString()])).toEqual([[2, "AMENDMENT", "APPROVED", "0.6"], [1, "ORIGINAL", "APPROVED", "0.5"]]);
    expect(detail.current?.version).toBe(1); // aditivo só vale a partir da vigência
    expect(await db.auditEvent.count({ where: { entityType: "Contract", entityId: c.id } })).toBeGreaterThanOrEqual(4);
  });

  it("unidade precisa estar vinculada ao parceiro e não pode estar em dois contratos", async () => {
    const s = await setup();
    await expect(createContract(s.a.ctx, { contract: { partnerOrganizationId: s.p1.id, title: "Errado", siteIds: [s.site2.id] }, terms: terms50() })).rejects.toThrow(/não está vinculada/);
    await createContract(s.a.ctx, { contract: { partnerOrganizationId: s.p1.id, title: "Primeiro", siteIds: [s.site1.id] }, terms: terms50() });
    await expect(createContract(s.a.ctx, { contract: { partnerOrganizationId: s.p1.id, title: "Segundo", siteIds: [s.site1.id] }, terms: terms50() })).rejects.toThrow(/já pertence/);
    await expect(createContract(s.a.ctx, { contract: { partnerOrganizationId: s.p1.id, title: "X", siteIds: [s.site1.id] }, terms: terms50({ lossTreatment: "CARRY_FORWARD", partnerShareBase: "GROSS_REVENUE" }) })).rejects.toThrow();
  });
});

describe("fechamento mensal", () => {
  it("fórmulas, prévia, aprovação por outra pessoa, resultado imutável e repasse provisionado → pago", async () => {
    const s = await setup();
    await standardData(s);
    const prev = await previewClosing(s.fin.ctx, PERIOD);
    expect(prev.validations.errors).toEqual([]);
    const l1 = prev.result.lines.find((l) => l.siteId === s.site1.id)!;
    // 1000 bruto; 6% = 60; sistema 10% = 100; líquida 840; royalty 8% = 67,20; energia 300; resultado 472,80; 50% = 236,40
    expect(l1).toMatchObject({ gross: "1000.00", taxTotal: "60.00", platformFee: "100.00", netRevenue: "840.00", royalty: "67.20", expenses: "300.00", operatingResult: "472.80", partnerShare: "236.40", operatorResult: "236.40" });
    const l2 = prev.result.lines.find((l) => l.siteId === s.site2.id)!;
    expect(l2.chargingRevenue).toBe("300.00"); // capturado − reembolsado

    const req = await requestClosing(s.fin.ctx, PERIOD);
    await expect(requestClosing(s.a.ctx, PERIOD)).rejects.toThrow(/pendente ou aprovado/);
    await expect(approveClosing(s.fin.ctx, req.id)).rejects.toThrow(/diferente de quem solicitou/);
    await approveClosing(s.b.ctx, req.id, "Conferido com extratos.");

    const closing = await getClosing(s.fin.ctx, req.id);
    expect(closing.status).toBe("APPROVED");
    expect(closing.hashValid).toBe(true);
    const repasse = closing.entries.find((e) => e.siteId === s.site1.id)!;
    expect(repasse).toMatchObject({ kind: "PAYABLE", category: "PARTNER_SHARE", status: "OPEN", source: "CLOSING" });
    expect(repasse.amount.toString()).toBe("236.4");
    expect(repasse.dueDate?.toISOString()).toBe("2026-10-11T03:00:00.000Z");

    // período fechado não aceita lançamento nem cancelamento
    await expect(createEntry(s.fin.ctx, { category: "RENT", description: "Aluguel atrasado", amount: 50, competence: PERIOD, siteId: s.site1.id })).rejects.toThrow(/está fechado/);
    const energy = await db.financialEntry.findFirstOrThrow({ where: { category: "ENERGY" } });
    await expect(cancelEntry(s.fin.ctx, { entryId: energy.id, reason: "lançado errado" })).rejects.toThrow(/está fechado/);
    await expect(cancelEntry(s.fin.ctx, { entryId: repasse.id, reason: "teste de cancelamento" })).rejects.toThrow(/ajuste/);

    let st = await getStatement(s.fin.ctx, PERIOD);
    expect(st.kind).toBe("CLOSED");
    expect(st.partnerPayment[s.p1.id]).toEqual({ provisioned: "236.40", paid: "0.00" });
    await settleEntry(s.fin.ctx, { entryId: repasse.id, paidAt: new Date(), paidAmount: 236.4, note: "TED comprovante 123" });
    await expect(settleEntry(s.fin.ctx, { entryId: repasse.id, paidAt: new Date(), paidAmount: 236.4, note: "duplicado" })).rejects.toThrow(/não está em aberto/);
    st = await getStatement(s.fin.ctx, PERIOD);
    expect(st.partnerPayment[s.p1.id]).toEqual({ provisioned: "0.00", paid: "236.40" });
    expect((await getClosing(s.fin.ctx, req.id)).resultHash).toBe(closing.resultHash); // baixa não altera o fechamento
  });

  it("reprocessamento: prévia idempotente; dado alterado entre prévia e aprovação → pedido superado", async () => {
    const s = await setup();
    await standardData(s);
    const h1 = (await computeClosing(s.op.id, PERIOD)).hash;
    expect((await computeClosing(s.op.id, PERIOD)).hash).toBe(h1);
    const req = await requestClosing(s.fin.ctx, PERIOD);
    await createEntry(s.fin.ctx, { category: "MAINTENANCE", description: "Visita técnica", amount: 80, competence: PERIOD, siteId: s.site1.id });
    await expect(approveClosing(s.b.ctx, req.id)).rejects.toThrow(/mudaram depois da prévia/);
    expect((await db.periodClosing.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("SUPERSEDED");
    const req2 = await requestClosing(s.fin.ctx, PERIOD);
    await approveClosing(s.b.ctx, req2.id);
    const l1 = (await getClosing(s.fin.ctx, req2.id)).result.lines.find((l) => l.siteId === s.site1.id)!;
    expect(l1).toMatchObject({ expenses: "380.00", operatingResult: "392.80", partnerShare: "196.40" });
  });

  it("recusa exige motivo; aprovações concorrentes: só uma vence", async () => {
    const s = await setup();
    await standardData(s);
    const req = await requestClosing(s.fin.ctx, PERIOD);
    await expect(rejectClosing(s.b.ctx, req.id, { note: "" })).rejects.toThrow();
    const c = await createUser(s.op.id, "admin");
    const results = await Promise.allSettled([approveClosing(s.b.ctx, req.id), approveClosing(c.ctx, req.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.periodClosing.count({ where: { status: "APPROVED" } })).toBe(1);
    expect(await db.financialEntry.count({ where: { source: "CLOSING" } })).toBe(2);
  });

  it("correção de período fechado só por ajuste em período aberto; fechamento original intacto", async () => {
    const s = await setup();
    const { c1 } = await standardData(s);
    await expect(createAdjustment(s.fin.ctx, { adjustsPeriod: PERIOD, contractId: c1.id, kind: "PAYABLE", amount: 10, description: "Período ainda aberto" })).rejects.toThrow(/só se aplica a período fechado/);
    const req = await requestClosing(s.fin.ctx, PERIOD);
    await approveClosing(s.b.ctx, req.id);
    const before = await getClosing(s.fin.ctx, req.id);
    const adj = await createAdjustment(s.fin.ctx, { adjustsPeriod: PERIOD, contractId: c1.id, kind: "RECEIVABLE", amount: 25.5, description: "Reembolso de recarga após o fechamento" });
    expect(adj).toMatchObject({ category: "ADJUSTMENT", source: "ADJUSTMENT", adjustsPeriod: PERIOD, competence: periodOf(new Date()), partnerOrganizationId: s.p1.id });
    const after = await getClosing(s.fin.ctx, req.id);
    expect(after.resultHash).toBe(before.resultHash);
    expect(after.adjustments.map((a) => a.id)).toEqual([adj.id]);
    // aditivo com vigência em período fechado não pode ser aprovado
    const v = await createAmendment(s.a.ctx, c1.id, terms50({ effectiveFrom: "2026-09-01T00:00:00-03:00", reason: "Retroativo indevido" }));
    await expect(decideContractVersion(s.b.ctx, v.id, { approve: true })).rejects.toThrow(/período já fechado/);
  });

  it("validações bloqueiam: período não terminado, unidade de parceiro sem contrato, mudança de condição no mês, ordem", async () => {
    const s = await setup();
    await createTaxRule(s.b.ctx, { name: "Simples", rate: 0.06, effectiveFrom: "2026-01-01T00:00:00-03:00" });
    await revenue(s.st1.id, "500.00");
    let v = (await computeClosing(s.op.id, PERIOD)).validations;
    expect(v.errors.join(" ")).toMatch(/Posto Um.*sem versão de contrato APROVADA/);
    await expect(requestClosing(s.fin.ctx, PERIOD)).rejects.toThrow(/Fechamento bloqueado/);

    const c1 = await contractFor(s, s.p1.id, s.site1.id);
    const am = await createAmendment(s.a.ctx, c1.id, terms50({ effectiveFrom: "2026-09-15T00:00:00-03:00", partnerShareRate: 0.4, reason: "Mudança no meio do mês" }));
    await decideContractVersion(s.b.ctx, am.id, { approve: true });
    v = (await computeClosing(s.op.id, PERIOD)).validations;
    expect(v.errors.join(" ")).toMatch(/muda dentro do período/);

    expect((await computeClosing(s.op.id, periodOf(new Date()))).validations.errors.join(" ")).toMatch(/ainda não terminou/);
    expect((await computeClosing(s.op.id, "2026-07")).validations.errors).toEqual([]);
    await approveClosing(s.b.ctx, (await requestClosing(s.fin.ctx, "2026-07")).id);
    expect((await computeClosing(s.op.id, PERIOD)).validations.errors.join(" ")).toMatch(/em ordem: 2026-08/);
  });
});

describe("permissões, isolamento e exportações", () => {
  it("parceiro vê só os próprios contratos, documentos e extratos; não acessa o financeiro", async () => {
    const s = await setup();
    const { c1, c2 } = await standardData(s);
    await approveClosing(s.b.ctx, (await requestClosing(s.fin.ctx, PERIOD)).id);
    const visible = await addAttachment(s.a.ctx, { entityType: "Contract", entityId: c1.id, filename: "contrato assinado.pdf", bytes: PDF, visibleToPartner: true });
    const internal = await addAttachment(s.a.ctx, { entityType: "Contract", entityId: c1.id, filename: "parecer interno.pdf", bytes: PDF });
    const other = await addAttachment(s.a.ctx, { entityType: "Contract", entityId: c2.id, filename: "contrato p2.pdf", bytes: PDF, visibleToPartner: true });

    const mine = await partnerContracts(s.partner1.ctx);
    expect(mine.map((c) => c.id)).toEqual([c1.id]);
    expect(mine[0].documents.map((d) => d.id)).toEqual([visible.id]);
    expect(JSON.stringify(mine)).not.toContain("operatorId");
    const statements = await partnerStatements(s.partner1.ctx);
    expect(statements).toHaveLength(1);
    expect(statements[0].lines.map((l) => l.siteId)).toEqual([s.site1.id]);
    expect(JSON.stringify(statements)).not.toContain(s.site2.id);
    expect(statements[0]).toMatchObject({ provisioned: "236.40", paid: "0.00" });

    expect((await getAttachmentForDownload(s.partner1.ctx, visible.id)).filename).toBe("contrato_assinado.pdf");
    await expect(getAttachmentForDownload(s.partner1.ctx, internal.id)).rejects.toThrow(/não encontrado/);
    await expect(getAttachmentForDownload(s.partner1.ctx, other.id)).rejects.toThrow(/não encontrado/);

    await expect(listEntries(s.partner1.ctx)).rejects.toThrow(/permissão/);
    await expect(previewClosing(s.partner1.ctx, PERIOD)).rejects.toThrow(/permissão/);
    await expect(getContract(s.partner1.ctx, c1.id)).rejects.toThrow(/permissão/);
    await expect(partnerContracts(s.fin.ctx)).rejects.toThrow(/permissão/);

    const csv = await exportPartnerStatementCsv(s.partner2.ctx, PERIOD);
    expect(csv.content).toContain("Posto Dois");
    expect(csv.content).not.toContain("Posto Um");
    expect(await db.auditEvent.count({ where: { action: "partner.statement_exported", organizationId: s.p2.id } })).toBe(1);
  });

  it("outra operadora não enxerga contratos, fechamentos nem lançamentos", async () => {
    const s = await setup();
    const { c1 } = await standardData(s);
    const op2 = await createOrg("Outra Operadora", "OPERATOR");
    const intruder = await createUser(op2.id, "admin");
    await expect(getContract(intruder.ctx, c1.id)).rejects.toThrow(/não encontrado/);
    expect(await listEntries(intruder.ctx)).toEqual([]);
    expect((await previewClosing(intruder.ctx, PERIOD)).result.lines).toEqual([]);
    const req = await requestClosing(s.fin.ctx, PERIOD);
    await expect(approveClosing(intruder.ctx, req.id)).rejects.toThrow(/não encontrado/);
    await expect(addAttachment(intruder.ctx, { entityType: "Contract", entityId: c1.id, filename: "x.pdf", bytes: PDF })).rejects.toThrow(/não encontrado/);
  });

  it("exportação exige finance:export e é auditada; transferência bancária nunca é iniciada sem provedor", async () => {
    const s = await setup();
    await standardData(s);
    await expect(exportStatementCsv(s.commercial.ctx, PERIOD)).rejects.toThrow(/permissão/);
    const csv = await exportStatementCsv(s.fin.ctx, PERIOD);
    expect(csv.filename).toBe(`demonstrativo-${PERIOD}-previa.csv`);
    expect(csv.content.split("\r\n")[0]).toContain("repasse_parceiro");
    expect(await db.auditEvent.count({ where: { action: "finance.statement_exported" } })).toBe(1);
    const e = await db.financialEntry.findFirstOrThrow();
    await expect(initiatePayout(s.fin.ctx, { entryId: e.id })).rejects.toThrow();
    await expect(initiatePayout(s.fin.ctx, { entryId: e.id, confirm: true })).rejects.toThrow(/não configurada/);
    await expect(initiatePayout(s.commercial.ctx, { entryId: e.id, confirm: true })).rejects.toThrow(/permissão/);
  });

  it("anexos: tipo verificado pelo conteúdo e limite de tamanho", async () => {
    const s = await setup();
    const c = await contractFor(s, s.p1.id, s.site1.id);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(addAttachment(s.a.ctx, { entityType: "Contract", entityId: c.id, filename: "x.pdf", bytes: html })).rejects.toThrow(/não permitido/);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PDF);
    await expect(addAttachment(s.a.ctx, { entityType: "Contract", entityId: c.id, filename: "x.pdf", bytes: big })).rejects.toThrow(/5 MB/);
    const ok = await addAttachment(s.a.ctx, { entityType: "Contract", entityId: c.id, filename: "../../etc/passwd", bytes: PDF });
    expect(ok.filename).toBe("etcpasswd.pdf");
    await expect(addAttachment(s.commercial.ctx, { entityType: "Contract", entityId: c.id, filename: "x.pdf", bytes: PDF })).rejects.toThrow(/permissão/);
  });
});
