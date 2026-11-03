import { expect, test } from "@playwright/test";
import { driverLogin, fx, staffLogin } from "./support/helpers";

test.describe("redesign: tema, navegação e painéis", () => {
  test("tema escuro: aplicado antes da pintura, salvo no cookie e mantido ao recarregar; 'Sistema' segue o aparelho", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/motorista?modo=demo");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "Escuro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(7, 13, 23)");
    expect((await page.context().cookies()).find((c) => c.name === "sm_theme")?.value).toBe("dark");
    // cartões, alertas e navegação usam a paleta escura (sem fundo branco sobrando)
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("nav[aria-label='Navegação do motorista']")!).backgroundColor)).toBe("rgb(14, 23, 38)");
    await page.getByRole("radio", { name: "Sistema" }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("operador do posto: portal com indicadores, gráficos e seções; menu do celular abre e fecha", async ({ page }) => {
    const f = fx();
    await page.setViewportSize({ width: 390, height: 844 });
    await staffLogin(page, f.partnerA);
    await page.goto("/app/portal");
    await expect(page.getByRole("heading", { name: /Meu posto — Parceiro A \(E2E\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operação das suas estações" })).toBeVisible();
    for (const t of ["Energia entregue", "Sua parte por competência", "Utilização por conector", "Disponibilidade por conector"]) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    // Estação do parceiro no E2E é de TESTE: os números de produção ficam vazios, com orientação (nada inventado).
    await expect(page.getByText("Nenhum fechamento aprovado ainda.").first()).toBeVisible();
    await page.getByRole("link", { name: "90 dias" }).click();
    await expect(page).toHaveURL(/periodo=90/);
    // Gaveta de navegação no celular
    const menu = page.getByRole("button", { name: "Abrir menu" });
    await expect(page.getByRole("navigation", { name: "Módulos" })).toBeHidden();
    await menu.click();
    await expect(page.getByRole("navigation", { name: "Módulos" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Módulos" }).getByRole("link", { name: "Portal do parceiro" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Módulos" })).toBeHidden();
  });

  test("administração: menu agrupado por área, alertas no cabeçalho, economia da WeMob e utilização por conector", async ({ page }) => {
    await staffLogin(page, fx().admin);
    await page.goto("/app?dados=teste");
    const nav = page.getByRole("navigation", { name: "Módulos" });
    for (const g of ["Visão geral", "Rede de recarga", "Financeiro", "Comercial", "Administração"]) await expect(nav.getByText(g, { exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Painel" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /alerta/i }).first()).toBeVisible();
    await expect(page.getByText("Economia da WeMob · últimos 6 meses")).toBeVisible();
    await expect(page.getByText("Utilização e disponibilidade por conector")).toBeVisible();
    await expect(page.getByRole("meter").first()).toBeVisible();
    await expect(page.getByText("Dados de teste e simulação incluídos")).toBeVisible(); // demonstrativo sempre identificado
  });

  test("motorista no escuro: estação e conta legíveis (sem texto branco sobre fundo branco)", async ({ page }) => {
    const f = fx();
    await page.emulateMedia({ colorScheme: "dark" });
    await driverLogin(page, f.driverA);
    await page.goto(`/motorista/estacoes/${f.station.identity}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const contrast = await page.evaluate(() => {
      const el = document.querySelector("h1")!;
      return { color: getComputedStyle(el).color, bg: getComputedStyle(document.body).backgroundColor };
    });
    expect(contrast).toEqual({ color: "rgb(238, 242, 247)", bg: "rgb(7, 13, 23)" });
  });
});
