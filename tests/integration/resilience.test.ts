import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { toActionState } from "@/server/action-result";
import { GET as health } from "@/app/api/health/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { previewClosing } from "@/server/modules/finance/closing";
import { opsPanel } from "@/server/modules/support/panel";
import { partnerStatements } from "@/server/modules/partner/portal";
import { bootstrapOperator, createOrg, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("resiliência e estados vazios (P10)", () => {
  it("health: 200 com banco; 503 sem banco, sem detalhes internos", async () => {
    const ok = await health(new Request("http://localhost/api/health"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok", db: "ok", automation: "never" });
    // Banco indisponível: sobrescreve só nesta chamada (o método vem do protótipo do cliente Prisma).
    const client = db as unknown as Record<string, unknown>;
    client.$queryRaw = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432 senha=xyz"));
    const down = await health(new Request("http://localhost/api/health")).finally(() => delete client.$queryRaw);
    expect(down.status).toBe(503);
    const body = await down.text();
    expect(body).toContain("unreachable");
    expect(body).not.toMatch(/ECONNREFUSED|senha|5432/);
  });

  it("health: migração pendente ou com falha num banco já populado → 503 (sem tráfego sobre schema errado)", async () => {
    expect(await (await health(new Request("http://localhost/api/health"))).json()).toMatchObject({ status: "ok", schema: "ok" });
    const client = db as unknown as Record<string, unknown>;
    const real = db.$queryRaw.bind(db);
    // Simula só a leitura de _prisma_migrations; o banco de teste não é tocado.
    const fake = (rows: unknown[]) => (strings: TemplateStringsArray, ...v: unknown[]) => (strings.join("?").includes("_prisma_migrations") ? Promise.resolve(rows) : real(strings, ...v));
    client.$queryRaw = fake([{ migration_name: "20261027125541_init", finished_at: new Date(), rolled_back_at: null }]);
    const pending = await health(new Request("http://localhost/api/health")).finally(() => delete client.$queryRaw);
    expect(pending.status).toBe(503);
    expect(await pending.json()).toMatchObject({ status: "degraded", db: "ok", schema: "migrations_pending" });
    client.$queryRaw = fake([{ migration_name: "20261027125541_init", finished_at: null, rolled_back_at: null }]);
    const failed = await health(new Request("http://localhost/api/health")).finally(() => delete client.$queryRaw);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ schema: "migration_failed" });
  });

  it("health para monitor externo: ?exigir=automacao dá 503 com o ciclo parado; o padrão continua 200", async () => {
    const strict = (q = "?exigir=automacao") => health(new Request(`http://localhost/api/health${q}`));
    expect((await strict()).status).toBe(503); // nunca rodou
    expect(await (await strict()).json()).toMatchObject({ status: "degraded", automation: "never" });
    expect((await strict("")).status).toBe(200);
    await db.automationRun.create({ data: { job: "alerts.evaluate", status: "SUCCEEDED", startedAt: new Date(Date.now() - 10 * 60_000), finishedAt: new Date() } });
    expect(await (await strict()).json()).toMatchObject({ automation: "stale" });
    await db.automationRun.create({ data: { job: "alerts.evaluate", status: "SUCCEEDED", startedAt: new Date(), finishedAt: new Date() } });
    expect((await strict()).status).toBe(200);
  });

  it("métricas: 404 sem token configurado ou errado; com token, números agregados sem dado pessoal", async () => {
    const token = "t".repeat(40);
    const call = (auth?: string) => metrics(new Request("http://localhost/api/metrics", { headers: auth ? { authorization: auth } : {} }));
    const prev = process.env.METRICS_TOKEN;
    try {
      delete process.env.METRICS_TOKEN;
      expect((await call(`Bearer ${token}`)).status).toBe(404);
      process.env.METRICS_TOKEN = token;
      expect((await call()).status).toBe(404);
      expect((await call("Bearer errado")).status).toBe(404);
      await bootstrapOperator();
      const ok = await call(`Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("text/plain");
      const body = await ok.text();
      for (const m of ["wemob_up 1", "wemob_db_latency_ms", 'wemob_schema_ok{state="ok"} 1', "wemob_automation_last_run_age_seconds", "wemob_webhook_events_pending 0", "wemob_payments_pending_production 0"]) expect(body).toContain(m);
      expect(body).not.toMatch(/@|cpf|senha|token/i);
    } finally {
      if (prev === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prev;
    }
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
