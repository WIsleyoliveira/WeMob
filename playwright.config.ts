import { defineConfig, devices } from "@playwright/test";

/**
 * E2E de navegador. NÃO rode `playwright test` direto: use `npm run e2e:browser`, que cria o banco temporário,
 * monta os dados de teste, sobe o build de produção (.next-e2e) com gateway SIMULADO e limpa tudo ao final.
 * Falhas guardam screenshot; trace só com E2E_TRACE=1 (o trace inclui cookies das sessões de teste).
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE ?? "http://127.0.0.1:3100",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    screenshot: "only-on-failure",
    trace: process.env.E2E_TRACE === "1" ? "retain-on-failure" : "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
