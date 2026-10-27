import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { toActionState } from "@/server/action-result";
import { GET as health } from "@/app/api/health/route";
import { previewClosing } from "@/server/modules/finance/closing";
import { opsPanel } from "@/server/modules/support/panel";
import { partnerStatements } from "@/server/modules/partner/portal";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("resiliência e estados vazios (P10)", () => {
  it("health: 200 com banco; 503 sem banco, sem detalhes internos", async () => {
    const ok = await health();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok", db: "ok", automation: "never" });
    // Banco indisponível: sobrescreve só nesta chamada (o método vem do protótipo do cliente Prisma).
    const client = db as unknown as Record<string, unknown>;
    client.$queryRaw = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432 senha=xyz"));
    const down = await health().finally(() => delete client.$queryRaw);
    expect(down.status).toBe(503);
    const body = await down.text();
    expect(body).toContain("unreachable");
    expect(body).not.toMatch(/ECONNREFUSED|senha|5432/);
  });

  it("erro inesperado vira mensagem genérica para o usuário", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await toActionState(async () => { throw new Error('Invalid `prisma.x` invocation: relation "Secret" password=abc'); });
    expect(r).toEqual({ status: "error", message: "Não foi possível concluir a operação. Tente novamente." });
  });

  it("estados vazios: prévia sem movimento, painel sem conectores, parceiro sem extratos", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const p = await previewClosing(admin.ctx, "2026-08");
    expect(p.result.lines).toEqual([]);
    expect(p.result.totals.gross).toBe("0.00");
    expect(p.validations.warnings.join(" ")).toMatch(/Nenhum tributo/);
    const panel = await opsPanel(admin.ctx, { from: new Date(Date.now() - 86400_000), to: new Date() });
    expect(panel).toMatchObject({ connectors: 0, availability: null, mttrHours: null, slaCompliance: null, downtimeHours: 0 });
    const partner = await createUser((await createOrg("Parceiro", "PARTNER")).id, "partner");
    expect(await partnerStatements(partner.ctx)).toEqual([]);
  });
});
