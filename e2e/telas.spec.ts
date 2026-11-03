import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { driverLogin, fx, staffLogin } from "./support/helpers";

/**
 * Capturas das telas (claro e escuro; desktop e celular) para revisão visual: `E2E_TELAS=1 npm run e2e:browser -- e2e/telas.spec.ts`.
 * Dados do banco E2E temporário: estações de TESTE/SIMULADAS e pagamentos do gateway simulado — as telas da equipe
 * usam "incluir teste/simulação", que a própria interface identifica. Arquivos em e2e-telas/ (fora do Git).
 */
test.skip(!process.env.E2E_TELAS, "capturas só com E2E_TELAS=1");
const DIR = "e2e-telas";
mkdirSync(DIR, { recursive: true });

async function shoot(page: Page, name: string, url: string, opts: { mobile?: boolean } = {}) {
  await page.setViewportSize(opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: "sm_theme", value: theme, url: page.url().startsWith("http") ? new URL(page.url()).origin : "http://127.0.0.1:3100" }]);
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${DIR}/${name}-${opts.mobile ? "celular" : "desktop"}-${theme === "light" ? "claro" : "escuro"}.png`, fullPage: true });
  }
}

test("telas da administração", async ({ page }) => {
  test.setTimeout(180_000);
  await staffLogin(page, fx().admin);
  await shoot(page, "admin-painel", "/app?dados=teste");
  await shoot(page, "admin-painel", "/app?dados=teste", { mobile: true });
  await shoot(page, "admin-custos", "/app/financeiro/custos");
  await shoot(page, "admin-pagamentos", "/app/pagamentos");
  await shoot(page, "admin-contrato-novo", "/app/contratos/novo");
});

test("telas do operador do posto", async ({ page }) => {
  test.setTimeout(120_000);
  await staffLogin(page, fx().partnerA);
  await shoot(page, "operador-portal", "/app/portal");
  await shoot(page, "operador-portal", "/app/portal", { mobile: true });
});

test("telas do motorista", async ({ page }) => {
  test.setTimeout(120_000);
  const f = fx();
  await driverLogin(page, f.driverA);
  await shoot(page, "motorista-inicio", "/motorista?modo=demo", { mobile: true });
  await shoot(page, "motorista-estacao", `/motorista/estacoes/${f.station.identity}`, { mobile: true });
  await shoot(page, "motorista-consumo", "/motorista/consumo?dados=teste", { mobile: true });
  await shoot(page, "motorista-conta", "/motorista/conta", { mobile: true });
});
