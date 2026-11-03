import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { driverLogin, fx, prisma } from "./support/helpers";

test.describe("motorista: favoritos e aparelhos conectados", () => {
  test("favoritar pela tela da estação: aparece em 'Favoritas' na tela inicial e sai ao remover", async ({ page }) => {
    const f = fx();
    await driverLogin(page, f.driverA);
    await page.goto(`/motorista/estacoes/${f.station.identity}`);
    await page.getByRole("button", { name: "Salvar nos favoritos" }).click();
    await expect(page.getByText("Estação salva nos favoritos.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Remover dos favoritos" })).toBeVisible();

    await page.goto("/motorista");
    const favs = page.getByRole("region", { name: "Favoritas" });
    await expect(favs.getByRole("link", { name: /Posto A \(E2E\)/ })).toBeVisible();
    await expect(favs).toContainText("(teste)"); // estação de TESTE identificada
    await favs.getByRole("link", { name: /Posto A \(E2E\)/ }).click();
    await expect(page).toHaveURL(new RegExp(`/motorista/estacoes/${f.station.identity}$`));

    await page.getByRole("button", { name: "Remover dos favoritos" }).click();
    await expect(page.getByText("Estação removida dos favoritos.")).toBeVisible();
    await page.goto("/motorista");
    await expect(page.getByRole("region", { name: "Favoritas" })).toHaveCount(0);
    expect(await prisma("driverFavoriteStation", "count", { where: { driverId: f.driverA.driverId } })).toBe(0);
  });

  test("aparelhos: a conta lista os acessos abertos; desconectar o outro encerra o acesso dele", async ({ page, browser }) => {
    // Conta nova (cadastro pela tela), para a lista conter só os dois aparelhos deste teste.
    const email = `e2e.aparelhos.${randomBytes(3).toString("hex")}@teste.local`;
    const password = `${randomBytes(12).toString("base64url")}Aa1`;
    await page.goto("/motorista/cadastro");
    await page.getByLabel("Nome").fill("Motorista Aparelhos E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL((u) => u.pathname.startsWith("/motorista") && !u.pathname.startsWith("/motorista/cadastro"));

    const otherCtx = await browser.newContext();
    const other = await otherCtx.newPage();
    await driverLogin(other, { email, password });

    await page.goto("/motorista/conta");
    const list = page.getByRole("list", { name: "Aparelhos conectados" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("este aparelho", { exact: true })).toHaveCount(1);
    await expect(list).not.toContainText("HeadlessChrome"); // só o rótulo genérico, nunca o User-Agent

    // O aparelho atual não tem botão de desconectar; o outro tem.
    await list.getByRole("button", { name: "Desconectar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Desconectar" }).click();
    // A linha (com o formulário e a mensagem dele) sai da lista: só o aparelho atual fica.
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText("este aparelho", { exact: true })).toHaveCount(1);

    await other.goto("/motorista/conta");
    await expect(other).toHaveURL(/\/motorista\/entrar/); // o cookie antigo deixou de valer
    await page.goto("/motorista/conta");
    await expect(page.getByRole("heading", { name: "Minha conta" })).toBeVisible(); // este continua
    await otherCtx.close();
  });
});
