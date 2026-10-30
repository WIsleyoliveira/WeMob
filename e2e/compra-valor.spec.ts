import { expect, test } from "@playwright/test";
import { driverLogin, fx, prisma } from "./support/helpers";

/**
 * B3 — compra por valor no navegador com o perfil de EXEMPLO (R$ 5–500, sugerido R$ 50; NÃO comerciais), ligado
 * só no servidor E2E (gateway local simulado, estação de TESTE). Roda antes de recarga.spec.ts e não inicia recarga.
 */
test("B3: valores de exemplo identificados; atalhos; resumo segue a tarifa e o limite; fora da faixa bloqueia", async ({ page }) => {
  const f = fx();
  await driverLogin(page, f.driverA);
  await page.goto(`/motorista/estacoes/${f.station.identity}`);
  await expect(page.getByText("Exemplo — não comercial")).toBeVisible();
  const field = page.getByLabel("Quanto você quer gastar (R$)");
  const start = page.getByRole("button", { name: "Iniciar recarga" });
  await expect(field).toHaveValue("50,00"); // sugerido de exemplo
  const box = page.getByLabel("Resumo antes de pagar");
  // R$ 50 a R$ 2,00/kWh equivale a 25 kWh; a recarga para em R$ 45,00 (margem 10%) → até 22,5 kWh.
  await expect(box).toContainText("Reservado agora no meio de pagamento");
  await expect(box).toContainText("25 kWh a R$ 2,00/kWh");
  await expect(box).toContainText("R$ 45,00");
  await expect(box).toContainText("até 22,5 kWh");
  await expect(start).toBeEnabled();

  await page.getByRole("group", { name: "Valores sugeridos" }).getByRole("button", { name: "R$ 100,00" }).click();
  await expect(field).toHaveValue("100,00");
  await expect(box).toContainText("R$ 90,00");

  await field.fill("4,99");
  await expect(page.getByText("Escolha um valor entre R$ 5,00 e R$ 500,00.")).toBeVisible();
  await expect(start).toBeDisabled();
  await field.fill("0x10");
  await expect(page.getByText("Digite só números, com até 2 casas decimais")).toBeVisible();
  await expect(start).toBeDisabled();
  await field.fill("");
  await expect(start).toBeDisabled();
  expect(await prisma<number>("chargeRequest", "count", { where: { driverId: f.driverA.driverId } })).toBe(0); // nada foi pedido
});
