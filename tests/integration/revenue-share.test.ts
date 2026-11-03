import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createSite, createStation } from "@/server/modules/stations/service";
import { createAmendment, createContract, decideContractVersion } from "@/server/modules/contracts/service";
import { previewClosing, requestClosing } from "@/server/modules/finance/closing";
import { exportStatementCsv } from "@/server/modules/finance/statement";
import { createEntry, createTaxRule } from "@/server/modules/finance/entries";
import { getPublicTerms } from "@/server/modules/commercial/service";
import { retireLegacy14Models } from "@/server/bootstrap";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const PERIOD = "2026-09";
let seq = 0;

const share = (o: Record<string, unknown> = {}) => ({
  effectiveFrom: "2026-01-01T00:00:00-03:00", revenueShareRate: 0.3, gatewayFeeBearer: "PENDING_DECISION", paymentTermDays: 10,
  conditions: "WeMob 30% / posto 70% do faturamento bruto mensal.", reason: "Regra comercial 30/70.", ...o,
});
const legacy = (o: Record<string, unknown> = {}) => ({
  effectiveFrom: "2026-01-01T00:00:00-03:00", royaltyRate: 0.05, royaltyBase: "GROSS_REVENUE", platformFeeRate: 0.14,
  partnerShareRate: 1, partnerShareBase: "OPERATING_RESULT", lossTreatment: "SHARE_MONTHLY", paymentTermDays: 10,
  conditions: "Contrato antigo com taxa de 14%.", reason: "Contrato original.", ...o,
});

async function setup() {
  const op = await bootstrapOperator();
  const a = await createUser(op.id, "admin");
  const b = await createUser(op.id, "admin");
  const fin = await createUser(op.id, "finance");
  const p1 = await createOrg("Posto Um Ltda", "PARTNER");
  const p2 = await createOrg("Posto Dois Ltda", "PARTNER");
  const site1 = await createSite(a.ctx, { name: "Posto Um", partnerOrganizationId: p1.id });
  const site2 = await createSite(a.ctx, { name: "Posto Dois", partnerOrganizationId: p2.id });
  const st1 = (await createStation(a.ctx, { siteId: site1.id, ocppIdentity: `CP-RS-${++seq}`, environment: "PRODUCTION" })).station;
  const st2 = (await createStation(a.ctx, { siteId: site2.id, ocppIdentity: `CP-RS-${++seq}`, environment: "PRODUCTION" })).station;
  return { op, a, b, fin, p1, p2, site1, site2, st1, st2 };
}

/** Receita de produção recebida: sessão encerrada no período + pagamento capturado (com tarifa real do gateway). */
async function revenue(stationId: string, captured: string, o: { refunded?: string; fee?: string; stoppedAt?: string; status?: string } = {}) {
  const stoppedAt = new Date(o.stoppedAt ?? "2026-09-15T12:00:00-03:00");
  const driver = await db.driver.create({ data: { email: `rs${++seq}@ex.com`, name: "M", passwordHash: "x", consentAt: new Date(), consentVer: "1" } });
  const session = await db.chargingSession.create({
    data: { stationId, connectorId: 1, transactionId: ++seq, idTag: `T${seq}`, environment: "PRODUCTION", meterStartWh: 0, meterStopWh: 10000, startedAt: new Date(stoppedAt.getTime() - 3600_000), stoppedAt, status: "COMPLETED", driverId: driver.id },
  });
  const refunded = o.refunded ?? "0";
  return db.payment.create({
    data: {
      driverId: driver.id, sessionId: session.id, provider: "real-teste", environment: "PRODUCTION", providerRef: `rs-${seq}`,
      status: (o.status ?? (Number(refunded) > 0 ? "PARTIALLY_REFUNDED" : "CAPTURED")) as "CAPTURED",
      amountAuthorized: captured, amountCaptured: o.status === "AUTHORIZED" ? "0" : captured, amountRefunded: refunded, feeAmount: o.fee ?? null, reconciledAt: new Date(),
    },
  });
}

async function approved(s: Awaited<ReturnType<typeof setup>>, partnerId: string, siteId: string, terms: Record<string, unknown>) {
  const c = await createContract(s.a.ctx, { contract: { partnerOrganizationId: partnerId, title: "Contrato do posto", siteIds: [siteId] }, terms });
  const v = await db.contractVersion.findFirstOrThrow({ where: { contractId: c.id } });
  await decideContractVersion(s.b.ctx, v.id, { approve: true }); // quatro olhos
  return c;
}

describe("contrato de participação 30/70", () => {
  it("grava a participação sem royalty nem taxa de sistema; posto = 70% do bruto", async () => {
    const s = await setup();
    const c = await approved(s, s.p1.id, s.site1.id, share());
    const v = await db.contractVersion.findFirstOrThrow({ where: { contractId: c.id } });
    expect([v.revenueShareRate?.toString(), v.royaltyRate.toString(), v.platformFeeRate.toString(), v.partnerShareRate.toString(), v.partnerShareBase, v.gatewayFeeBearer]).toEqual(["0.3", "0", "0", "0.7", "GROSS_REVENUE", "PENDING_DECISION"]);
  });

  it("valida a participação e exige os campos do modelo antigo só quando ele é escolhido", async () => {
    const s = await setup();
    const base = { partnerOrganizationId: s.p1.id, title: "X", siteIds: [s.site1.id] };
    await expect(createContract(s.a.ctx, { contract: base, terms: share({ revenueShareRate: 0 }) })).rejects.toThrow();
    await expect(createContract(s.a.ctx, { contract: base, terms: share({ revenueShareRate: 1 }) })).rejects.toThrow();
    await expect(createContract(s.a.ctx, { contract: base, terms: share({ gatewayFeeBearer: "NINGUEM" }) })).rejects.toThrow();
    const { revenueShareRate: _r, ...noShare } = share();
    await expect(createContract(s.a.ctx, { contract: base, terms: noShare })).rejects.toThrow(); // nem participação nem modelo antigo
  });
});

describe("fechamento com participação 30/70", () => {
  it("reparte o RECEBIDO (capturado − estornado), conserva centavos e não desconta tributos nem custos de nenhuma das partes", async () => {
    const s = await setup();
    await approved(s, s.p2.id, s.site2.id, share({ gatewayFeeBearer: "PARTNER" }));
    await createTaxRule(s.b.ctx, { name: "Simples Nacional", rate: 0.06, effectiveFrom: "2026-01-01T00:00:00-03:00" });
    await revenue(s.st2.id, "1000.00", { refunded: "100.00", fee: "19.99" });
    await revenue(s.st2.id, "0.05", { fee: "0" });
    await revenue(s.st2.id, "500.00", { status: "AUTHORIZED" }); // autorizado e não capturado: não entra
    await revenue(s.st2.id, "80.00", { status: "DISPUTED" }); // chargeback em disputa: bloqueado, não entra
    await createEntry(s.fin.ctx, { category: "ENERGY", description: "Conta de energia", amount: 200, competence: PERIOD, siteId: s.site2.id });
    const p = await previewClosing(s.fin.ctx, PERIOD);
    const l = p.result.lines.find((x) => x.siteId === s.site2.id)!;
    // bruto 900,05; WeMob 30% = 270,015 → 270,02; posto 630,03; tarifa 19,99 do posto → 610,04
    expect(l).toMatchObject({ shareModel: "REVENUE_SHARE", gross: "900.05", wemobShare: "270.02", partnerGrossShare: "630.03", gatewayFeesPartner: "19.99", partnerShare: "610.04", operatorResult: "270.02", platformFee: "0.00", royalty: "0.00", taxTotal: "54.00", expenses: "200.00" });
    expect(p.validations.errors).toEqual([]);
    expect(p.validations.warnings.join(" ")).toMatch(/tributos e despesas da unidade aparecem à parte/);
    expect(p.validations.warnings.join(" ")).toMatch(/não capturado/);
    expect(p.validations.warnings.join(" ")).toMatch(/1 pagamento\(s\) em disputa \(chargeback\), total 80\.00: bloqueados/);
    expect(p.result.totals).toMatchObject({ wemobShare: "270.02", partnerGrossShare: "630.03" });
  });

  it("tarifas do gateway sem responsável definido bloqueiam o fechamento (só prévia)", async () => {
    const s = await setup();
    await approved(s, s.p1.id, s.site1.id, share());
    await revenue(s.st1.id, "100.00", { fee: "1.99" });
    const p = await previewClosing(s.fin.ctx, PERIOD);
    expect(p.validations.errors.join(" ")).toMatch(/tarifas do gateway de 1\.99 sem responsável definido/);
    await expect(requestClosing(s.fin.ctx, PERIOD)).rejects.toThrow(/sem responsável definido/);
    expect(await db.periodClosing.count()).toBe(0);
  });

  it("aditivo para 30/70 vale só da vigência em diante: o mês anterior segue o contrato antigo (nada retroativo)", async () => {
    const s = await setup();
    const c = await approved(s, s.p1.id, s.site1.id, legacy());
    const v2 = await createAmendment(s.a.ctx, c.id, share({ effectiveFrom: "2026-10-01T00:00:00-03:00", gatewayFeeBearer: "WEMOB", reason: "Aditivo: participação 30/70." }));
    await decideContractVersion(s.b.ctx, v2.id, { approve: true });
    await revenue(s.st1.id, "1000.00", { stoppedAt: "2026-09-20T12:00:00-03:00" });
    await revenue(s.st1.id, "1000.00", { stoppedAt: "2026-10-20T12:00:00-03:00", fee: "10.00" });
    const sep = (await previewClosing(s.fin.ctx, "2026-09")).result.lines[0];
    expect(sep.shareModel).toBeUndefined();
    expect(sep).toMatchObject({ platformFee: "140.00", royalty: "50.00" }); // condição antiga preservada em setembro
    const oct = (await previewClosing(s.fin.ctx, "2026-10")).result.lines[0];
    expect(oct).toMatchObject({ shareModel: "REVENUE_SHARE", wemobShare: "300.00", partnerShare: "700.00", gatewayFeesWemob: "10.00", operatorResult: "290.00", platformFee: "0.00" });
  });

  it("CSV do demonstrativo traz modelo, participação, parte do posto e tarifas", async () => {
    const s = await setup();
    await approved(s, s.p2.id, s.site2.id, share({ gatewayFeeBearer: "PROPORTIONAL" }));
    await revenue(s.st2.id, "100.00", { fee: "3.00" });
    const { content } = await exportStatementCsv(s.fin.ctx, PERIOD);
    const [header, row] = content.replace("﻿", "").split("\r\n");
    expect(header).toContain("modelo,participacao_wemob,parte_posto,tarifas_gateway,tarifas_sem_responsavel");
    // proporcional: tarifa 3,00 → WeMob 0,90 / posto 2,10; posto 70,00 − 2,10 = 67,90; WeMob 30,00 − 0,90 = 29,10
    expect(row).toContain('"67.90","29.10","participacao_bruto","30.00","70.00","3.00","0.00"');
  });
});

describe("substituição da taxa de 14%", () => {
  it("o seed tira de vigência os modelos de 14%; só a participação 30/70 fica pública; idempotente", async () => {
    const s = await setup();
    const before = await getPublicTerms();
    expect(before.map((t) => t.terms.modelKey).sort()).toEqual(["compra-integral", "parceria-50-50", "participacao-30-70"]);
    expect(await retireLegacy14Models(db, s.op.id)).toBe(2);
    const after = await getPublicTerms();
    expect(after.map((t) => t.terms.modelKey)).toEqual(["participacao-30-70"]);
    expect(after[0].terms).toMatchObject({ revenueShareRate: 0.3, platformFeeRate: 0.3, royaltyRate: 0, partnerResultShare: 1, platformFeeIncludesGateway: false });
    expect(await retireLegacy14Models(db, s.op.id)).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "commercial_version.retired_legacy_14" } })).toBe(2);
    // versões antigas continuam no banco como histórico
    expect(await db.commercialModelVersion.count({ where: { status: "RETIRED", platformFeeRate: 0.14 } })).toBe(2);
  });
});
