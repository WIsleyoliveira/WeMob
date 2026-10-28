import { expect, test } from "@playwright/test";
import { driverLogin, fx, prisma, staffLogin } from "./support/helpers";

test.describe("A. autenticação e autorização", () => {
  test("login inválido mostra erro e não cria sessão", async ({ page }) => {
    const f = fx();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(f.admin.email);
    await page.getByLabel("Senha").fill("senha-errada-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    expect((await page.context().cookies()).some((c) => c.name === "sm_session")).toBe(false);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("página protegida sem sessão leva ao login; login válido abre o painel", async ({ page }) => {
    await page.goto("/app/pagamentos");
    await expect(page).toHaveURL(/\/login/);
    await staffLogin(page, fx().admin);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("parceiro não abre a unidade de outro parceiro (404) e não acessa áreas sem permissão", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.partnerA);
    await page.goto(`/app/unidades/${f.siteA}`);
    await expect(page.getByRole("heading", { name: "Posto A (E2E)" })).toBeVisible();
    await page.goto(`/app/unidades/${f.siteB}`);
    await expect(page.getByText("Página não encontrada")).toBeVisible();
    await page.goto("/app/pagamentos");
    await expect(page).toHaveURL(/\/app\/sem-permissao/);
  });

  test("sair revoga a sessão: o mesmo cookie deixa de valer", async ({ page, context }) => {
    await staffLogin(page, fx().admin);
    const cookie = (await context.cookies()).find((c) => c.name === "sm_session")!;
    expect(cookie).toBeTruthy();
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login|\/$/);
    await context.addCookies([cookie]); // tenta reutilizar o cookie antigo
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("motorista não vê a recarga de outro motorista; equipe não usa a área do motorista", async ({ page }) => {
    const f = fx();
    const now = new Date().toISOString();
    const s = await prisma<{ id: string }>("chargingSession", "create", { data: { stationId: f.station.id, connectorId: 1, transactionId: 900_001, idTag: "TEST-E2E-ISOLAMENTO", environment: "TEST", meterStartWh: 0, meterStopWh: 1000, startedAt: now, stoppedAt: now, status: "COMPLETED", driverId: f.driverA.driverId } });
    await driverLogin(page, f.driverB);
    await page.goto(`/motorista/recarga/${s.id}`);
    await expect(page.getByText("Página não encontrada")).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});
