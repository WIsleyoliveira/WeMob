import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveVersion, createDraftVersion, getPublicTerms } from "@/server/modules/commercial/service";
import { revokeMembership } from "@/server/modules/identity/service";
import { bootstrapOperator, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);

const draft = { referenceInvestment: 150000, partnerCapitalShare: 1, partnerResultShare: 1, royaltyRate: 0.07, royaltyBase: "GROSS_REVENUE", platformFeeRate: 0.14, platformFeeBase: "GROSS_REVENUE", taxRate: 0.06, taxBase: "GROSS_REVENUE", maintenancePolicy: "Conforme contrato" };

describe("achados da auditoria (P02)", () => {
  it("versão aprovada com vigência futura não deixa o modelo sem condição vigente", async () => {
    const op = await bootstrapOperator();
    const a = await createUser(op.id, "admin");
    const b = await createUser(op.id, "admin");
    const model = await db.commercialModel.findFirstOrThrow({ where: { key: "compra-integral" } });
    const future = new Date(Date.now() + 30 * 86400000);
    const v2 = await createDraftVersion(a.ctx, model.id, { ...draft, effectiveFrom: future });
    await approveVersion(b.ctx, v2.id);
    const pub = await getPublicTerms();
    const current = pub.find((p) => p.terms.modelKey === "compra-integral");
    expect(current?.terms.version).toBe(1);
    expect(current?.terms.royaltyRate).toBe(0.05);
  });

  it("administrador não pode revogar o próprio acesso", async () => {
    const op = await bootstrapOperator();
    const a = await createUser(op.id, "admin");
    await expect(revokeMembership(a.ctx, a.membership.id)).rejects.toThrow(/próprio/);
  });
});
