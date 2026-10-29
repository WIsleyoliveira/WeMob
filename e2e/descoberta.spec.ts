import { expect, test } from "@playwright/test";
import { driverLogin, fx, prisma } from "./support/helpers";

/**
 * P23 B2 — descoberta pelo navegador (aba Demonstração, estações SIMULADAS do banco temporário):
 * filtros pela URL, "disponível agora" sem estação sem comunicação, compatibilidade pelo conector do veículo e
 * ordenação por distância com localização emulada pelo navegador (não enviada ao servidor).
 */
test.describe("B2. descoberta de estações", () => {
  test("filtros por conector, potência, preço e disponibilidade; limpar filtros", async ({ page }) => {
    const { demo } = fx();
    await page.goto("/motorista?modo=demo");
    const list = page.getByRole("list", { name: "Estações" });
    for (const s of Object.values(demo)) await expect(list.getByText(s.name)).toBeVisible();
    await expect(list.getByText("Sem comunicação recente: disponibilidade desconhecida")).toHaveCount(1);

    await page.locator("summary", { hasText: "Filtros" }).click();
    await page.getByLabel("Conector").selectOption("TYPE2");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(page).toHaveURL(/conector=TYPE2/);
    await expect(page.getByText("1 estação encontrada")).toBeVisible();
    await expect(list.getByText(demo.rjType2.name)).toBeVisible();
    await expect(list.getByText(demo.spFast.name)).toHaveCount(0);

    await page.goto("/motorista?modo=demo&potencia=50");
    await expect(list.getByText(demo.spFast.name)).toBeVisible();
    await expect(list.getByText(demo.spOffline.name)).toBeVisible();
    await expect(list.getByText(demo.rjType2.name)).toHaveCount(0);

    // "Disponível agora" nunca inclui a estação sem comunicação, mesmo com o último status "disponível".
    await page.goto("/motorista?modo=demo&potencia=50&disponivel=1");
    await expect(page.getByText("1 estação encontrada")).toBeVisible();
    await expect(list.getByText(demo.spFast.name)).toBeVisible();

    await page.goto("/motorista?modo=demo&preco=1,8");
    await expect(page.getByText("1 estação encontrada")).toBeVisible();
    await expect(list.getByText(demo.rjType2.name)).toBeVisible();

    await page.goto("/motorista?modo=demo&conector=CHADEMO");
    await expect(page.getByText("Nenhuma estação com esses filtros")).toBeVisible();
    await page.getByRole("link", { name: "Limpar filtros" }).first().click();
    await expect(page).toHaveURL(/\/motorista\?modo=demo$/);
    for (const s of Object.values(demo)) await expect(list.getByText(s.name)).toBeVisible();

    await page.goto("/motorista?modo=demo&conector=XPTO&potencia=-1"); // parâmetros inválidos são ignorados
    for (const s of Object.values(demo)) await expect(list.getByText(s.name)).toBeVisible();
  });

  test("compatibilidade pelo conector do veículo cadastrado (sem afirmar potência)", async ({ page }) => {
    const f = fx();
    await prisma("vehicle", "create", { data: { driverId: f.driverB.driverId, label: "Carro Tipo 2 E2E", connectorTypes: ["TYPE2"] } });
    await driverLogin(page, f.driverB);
    await page.goto("/motorista?modo=demo&compativel=1");
    const list = page.getByRole("list", { name: "Estações" });
    await expect(page.getByText("1 estação encontrada")).toBeVisible();
    await expect(list.getByText(f.demo.rjType2.name)).toBeVisible();
    await expect(list.getByText("Conector compatível com seu veículo")).toBeVisible();

    await page.goto(`/motorista/estacoes/${f.demo.rjType2.identity}`);
    await expect(page.getByText("Compatível com Carro Tipo 2 E2E pelo tipo de conector.")).toBeVisible();
    await expect(page.getByText("A potência aceita pelo veículo não é verificada.")).toBeVisible();
    await page.goto(`/motorista/estacoes/${f.demo.spFast.identity}`);
    await expect(page.getByText("Nenhum veículo seu cadastrado com conector CCS2.")).toBeVisible();
  });

  test("ordenar pelas mais próximas usa a localização só no navegador; sem permissão a lista continua", async ({ browser }) => {
    const { demo } = fx();
    const near = await browser.newContext({ geolocation: { latitude: -22.95, longitude: -43.2 }, permissions: ["geolocation"], locale: "pt-BR" });
    const page = await near.newPage();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url() + (r.postData() ?? "")));
    await page.goto("/motorista?modo=demo");
    await page.getByRole("button", { name: "Ordenar pelas mais próximas" }).click();
    await expect(page.getByText("Ordenado pela distância em linha reta até você.")).toBeVisible();
    const names = page.getByRole("list", { name: "Estações" }).getByRole("listitem");
    await expect(names.first()).toContainText(demo.rjType2.name);
    await expect(names.first()).toContainText("km em linha reta");
    expect(requests.some((u) => u.includes("-22.95") || u.includes("-43.2"))).toBe(false); // a posição não sai do navegador
    await near.close();

    const denied = await browser.newContext({ permissions: [], locale: "pt-BR" });
    const p2 = await denied.newPage();
    await p2.goto("/motorista?modo=demo");
    await p2.getByRole("button", { name: "Ordenar pelas mais próximas" }).click();
    await expect(p2.getByText(/Sem permissão de localização|Não foi possível obter sua localização/)).toBeVisible();
    for (const s of Object.values(demo)) await expect(p2.getByRole("list", { name: "Estações" }).getByText(s.name)).toBeVisible();
    await denied.close();
  });
});
