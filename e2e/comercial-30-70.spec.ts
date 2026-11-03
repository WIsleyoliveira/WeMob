import { expect, test } from "@playwright/test";
import { fx, prisma, staffLogin } from "./support/helpers";

test.describe("regra comercial 30/70", () => {
  test("site público mostra a participação 30/70 e não divulga mais a taxa de 14%", async ({ page }) => {
    await page.goto("/modelos");
    const card = page.getByRole("article").filter({ hasText: "Participação 30/70 sobre o faturamento bruto" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("30% do faturamento bruto mensal");
    await expect(card).toContainText("70% do faturamento bruto mensal");
    await expect(page.getByRole("article")).toHaveCount(1); // modelos de 14% fora de vigência
    await expect(page.getByText("Sistema + gateway")).toHaveCount(0);
    await expect(page.getByText("14%")).toHaveCount(0);
  });

  test("contrato novo pela tela já nasce na participação 30/70, com tarifas do gateway 'a definir'", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.admin);
    await page.goto("/app/contratos/novo");
    await page.getByLabel("Parceiro / investidor").selectOption({ label: "Parceiro B (E2E) (parceiro)" });
    await page.getByLabel("Título").fill("Contrato 30/70 (E2E)");
    await page.getByRole("checkbox", { name: /Posto B \(E2E\)/ }).check();
    await page.getByLabel("Início da vigência").fill("2026-12-01");
    await expect(page.getByLabel("Participação da WeMob (%)")).toHaveValue("30");
    await page.getByLabel("Condições (texto contratual)").fill("WeMob 30% / posto 70% do faturamento bruto mensal.");
    await page.getByLabel(/Motivo/).fill("Contrato de teste E2E da regra 30/70.");
    await page.getByRole("button", { name: "Criar contrato (rascunho)" }).click();
    await expect(page).toHaveURL(/\/app\/contratos\/c/);
    await expect(page.getByText("30,00% do faturamento bruto")).toBeVisible();
    await expect(page.getByText("70,00% do faturamento bruto")).toBeVisible();
    await expect(page.getByText("A definir (decisão da WAPE)")).toBeVisible();
    await expect(page.getByText("Taxa de sistema (modelo antigo)")).toHaveCount(0);
    const v = await prisma<{ revenueShareRate: string; platformFeeRate: string; royaltyRate: string; partnerShareRate: string; status: string }>("contractVersion", "findFirstOrThrow", { where: { contract: { title: "Contrato 30/70 (E2E)" } } });
    expect(v).toMatchObject({ revenueShareRate: "0.3", platformFeeRate: "0", royaltyRate: "0", partnerShareRate: "0.7", status: "DRAFT" });
  });

  test("PWA: manifest do motorista servido com ícones instaláveis", async ({ request }) => {
    const r = await request.get("/manifest.webmanifest");
    expect(r.ok()).toBe(true);
    const m = await r.json();
    expect(m).toMatchObject({ start_url: "/motorista", scope: "/motorista", display: "standalone" });
    for (const i of m.icons as { src: string }[]) expect((await request.get(i.src)).ok()).toBe(true);
  });
});
