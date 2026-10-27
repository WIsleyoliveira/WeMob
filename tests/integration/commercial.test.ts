import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveVersion, createDraftVersion, getPublicTerms, saveSimulation } from "@/server/modules/commercial/service";
import { bootstrapOperator, createUser, resetDb } from "./fixtures";

const simInput = {
  chargers: [{ count: 1, powerKw: 60 }],
  availability: 1,
  equivalentHoursPerDay: 4,
  daysPerMonth: 30,
  pricePerKwh: 2.4,
  energyCostPerKwh: 1,
  fixedMonthly: { connectivity: 150 },
  investment: { projectAndImplementation: 150000 },
  horizonMonths: 24,
};

beforeEach(resetDb);

describe("modelos comerciais versionados", () => {
  it("nova taxa vale para novas simulações sem alterar as já registradas", async () => {
    const op = await bootstrapOperator();
    const author = await createUser(op.id, "admin");
    const approver = await createUser(op.id, "admin");
    const model = await db.commercialModel.findFirstOrThrow({ where: { key: "compra-integral" } });
    const v1 = await db.commercialModelVersion.findFirstOrThrow({ where: { modelId: model.id, version: 1 } });

    const before = await saveSimulation(author.ctx, { name: "Antes", versionId: v1.id, input: simInput });

    const draft = await createDraftVersion(author.ctx, model.id, {
      referenceInvestment: 150000, partnerCapitalShare: 1, partnerResultShare: 1,
      royaltyRate: 0.07, royaltyBase: "GROSS_REVENUE", platformFeeRate: 0.14, platformFeeBase: "GROSS_REVENUE",
      taxRate: 0.06, taxBase: "GROSS_REVENUE", maintenancePolicy: "Conforme contrato",
    });
    expect(draft.version).toBe(2);
    await expect(approveVersion(author.ctx, draft.id)).rejects.toThrow(/diferente de quem criou/);
    await approveVersion(approver.ctx, draft.id);

    const statuses = await db.commercialModelVersion.findMany({ where: { modelId: model.id }, orderBy: { version: "asc" } });
    expect(statuses.map((s) => s.status)).toEqual(["RETIRED", "APPROVED"]);
    await expect(approveVersion(approver.ctx, draft.id)).rejects.toThrow(/rascunho/);

    const after = await saveSimulation(author.ctx, { name: "Depois", versionId: draft.id, input: simInput });
    const reloaded = await db.simulation.findUniqueOrThrow({ where: { id: before.id } });
    const royaltyOf = (s: { results: unknown }) => (s.results as { months: { royalty: string }[] }).months[0].royalty;
    expect(royaltyOf(reloaded)).toBe("864.00"); // 5% — intacto
    expect(royaltyOf(after)).toBe("1209.60"); // 7%

    const pub = await getPublicTerms();
    expect(pub.find((p) => p.terms.modelKey === "compra-integral")?.terms.royaltyRate).toBe(0.07);
  });

  it("ignora termos enviados pelo cliente e usa os da versão no banco", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const v1 = await db.commercialModelVersion.findFirstOrThrow({ where: { model: { key: "compra-integral" } } });
    const sim = await saveSimulation(u.ctx, {
      name: "Tentativa", versionId: v1.id,
      input: { ...simInput, terms: { royaltyRate: 0 } },
    });
    expect((sim.results as { months: { royalty: string }[] }).months[0].royalty).toBe("864.00");
  });

  it("rejeita base de taxa de sistema circular ao criar versão", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "admin");
    const model = await db.commercialModel.findFirstOrThrow();
    await expect(createDraftVersion(u.ctx, model.id, {
      referenceInvestment: 1, partnerCapitalShare: 1, partnerResultShare: 1, royaltyRate: 0.05, royaltyBase: "GROSS_REVENUE",
      platformFeeRate: 0.14, platformFeeBase: "GROSS_NET_OF_PAYMENT_FEES", taxRate: 0.06, taxBase: "GROSS_REVENUE", maintenancePolicy: "xxx",
    })).rejects.toThrow();
  });
});

describe("revisões de simulação (P05)", () => {
  it("registra revisão com autor, número e premissas alteradas", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const v1 = await db.commercialModelVersion.findFirstOrThrow({ where: { model: { key: "compra-integral" } } });
    const { getSimulation } = await import("@/server/modules/commercial/service");
    const s1 = await saveSimulation(u.ctx, { name: "Base", versionId: v1.id, input: simInput });
    const s2 = await saveSimulation(u.ctx, { name: "Preço maior", versionId: v1.id, parentId: s1.id, input: { ...simInput, pricePerKwh: 2.6, workingCapital: 5000 } });
    expect(s2.revision).toBe(2);
    expect(s2.changes).toEqual([
      { path: "pricePerKwh", before: 2.4, after: 2.6 },
      { path: "workingCapital", before: 0, after: 5000 },
    ]);
    const full = await getSimulation(u.ctx, s1.id);
    expect(full.revisions.map((r) => r.id)).toEqual([s2.id]);
    expect(full.authorName).toBe(u.user.name);
    expect((full.results as { engineVersion: string }).engineVersion).toBe("viability-2.0.0");
  });

  it("não aceita simulação de outra organização como origem", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const v1 = await db.commercialModelVersion.findFirstOrThrow({ where: { model: { key: "compra-integral" } } });
    const s1 = await saveSimulation(u.ctx, { name: "Base", versionId: v1.id, input: simInput });
    const { createOrg } = await import("./fixtures");
    const other = await createOrg("Outra", "OPERATOR");
    const { ensureReferenceModels } = await import("@/server/bootstrap");
    await ensureReferenceModels(db, other.id);
    const intruder = await createUser(other.id, "commercial");
    const ov = await db.commercialModelVersion.findFirstOrThrow({ where: { model: { organizationId: other.id } } });
    await expect(saveSimulation(intruder.ctx, { name: "Teste", versionId: ov.id, parentId: s1.id, input: simInput })).rejects.toThrow(/origem não encontrada/);
  });

  it("modelo com gateway incluso recusa custo de gateway à parte também ao salvar", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const v1 = await db.commercialModelVersion.findFirstOrThrow({ where: { model: { key: "compra-integral" } } });
    await expect(saveSimulation(u.ctx, { name: "Teste", versionId: v1.id, input: { ...simInput, gatewayRate: 0.02 } })).rejects.toThrow(/dupla contagem/);
  });
});
