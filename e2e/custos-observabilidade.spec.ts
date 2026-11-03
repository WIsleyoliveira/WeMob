import { expect, test } from "@playwright/test";
import { fx, staffLogin } from "./support/helpers";

/**
 * Um único login do perfil financeiro (o login da equipe tem limite de 10 tentativas por conta a cada 15 min e o
 * financeiro.spec já usa a mesma conta).
 */
test("custos da plataforma, Excel nativo e correlação (perfil financeiro)", async ({ page }) => {
  test.setTimeout(90_000);
  await staffLogin(page, fx().finance);

  // 1) Orçamento da planilha: sem postos de produção no E2E = só a plataforma (R$ 1.952,32); simulação de 10 postos.
  await page.goto("/app/financeiro/custos");
  await expect(page.getByRole("heading", { name: "Custos da plataforma" })).toBeVisible();
  await expect(page.getByText("Despesa da WeMob — separada da receita")).toBeVisible();
  const items = page.getByRole("table").first();
  await expect(items).toContainText("Servidor app e API");
  await expect(items).toContainText("R$ 1.952,32");
  await page.getByLabel("Postos").fill("10");
  await page.getByRole("button", { name: "Recalcular" }).click();
  await expect(page).toHaveURL(/postos=10/);
  await expect(page.getByText("R$ 5.952,32").first()).toBeVisible(); // cenário "Rede média" da planilha

  // 2) Custo realizado em dólar: o valor em reais é calculado pelo câmbio informado.
  await page.goto("/app/financeiro/custos");
  await page.getByLabel("Descrição").fill("Servidor — fatura em dólar (E2E)");
  await page.getByLabel("Moeda").selectOption("USD");
  await page.getByLabel("Valor em US$").fill("100");
  await page.getByLabel("Câmbio (R$ por US$)").fill("5.4321");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Custo realizado registrado.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Servidor — fatura em dólar (E2E)" })).toContainText("R$ 543,21");

  // 3) Exportações em Excel baixadas pelo próprio navegador (com a sessão): .xlsx válido e x-request-id na resposta.
  for (const url of ["/api/financeiro/exportar?tipo=custos&formato=xlsx", "/api/financeiro/exportar?periodo=2026-09&formato=xlsx", "/api/financeiro/exportar?tipo=lancamentos&formato=xlsx"]) {
    const r = await page.evaluate(async (u) => {
      const res = await fetch(u);
      const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
      return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), requestId: res.headers.get("x-request-id"), magic: Array.from(head).map((b) => b.toString(16).padStart(2, "0")).join("") };
    }, url);
    expect(r, url).toMatchObject({ status: 200, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: "504b0304" });
    expect(r.disposition).toMatch(/\.xlsx"$/);
    expect(r.requestId).toMatch(/^[0-9a-f-]{36}$/);
  }
});

test("x-request-id do proxy é reaproveitado; métricas sem token configurado não existem (404)", async ({ request }) => {
  const kept = await request.get("/api/health", { headers: { "x-request-id": "proxy-e2e-0001" } });
  expect(kept.headers()["x-request-id"]).toBe("proxy-e2e-0001");
  const fresh = await request.get("/api/health", { headers: { "x-request-id": "<script>" } });
  expect(fresh.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  expect((await request.get("/api/metrics")).status()).toBe(404);
});
