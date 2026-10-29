import { expect, test } from "@playwright/test";
import { driverLogin, fx, prisma } from "./support/helpers";

/**
 * B3 — compra por valor no navegador. A faixa usada (R$ 1,00 a R$ 200,00) é de TESTE, definida só no servidor
 * E2E: a WAPE ainda não definiu os limites comerciais. Gateway local simulado (pré-autorização), sem dinheiro.
 * Roda antes de recarga.spec.ts (ordem alfabética) e não inicia recarga: só verifica resumo e validações.
 */
test("B3: resumo antes de pagar segue a tarifa e o limite; valores fora da faixa bloqueiam o envio", async ({ page }) => {
  const f = fx();
  await driverLogin(page, f.driverA);
  await page.goto(`/motorista/estacoes/${f.station.identity}`);
  await expect(page.getByText("Você escolhe quanto quer reservar (entre R$ 1,00 e R$ 200,00)")).toBeVisible();
  const field = page.getByLabel("Quanto você quer gastar (R$)");
  const start = page.getByRole("button", { name: "Iniciar recarga" });
  await expect(start).toBeDisabled(); // sem valor não envia

  await field.fill("250");
  await expect(page.getByText("Escolha um valor entre R$ 1,00 e R$ 200,00.")).toBeVisible();
  await expect(start).toBeDisabled();
  await field.fill("12,345");
  await expect(page.getByText("Use reais com até 2 casas decimais.")).toBeVisible();
  await expect(start).toBeDisabled();

  // R$ 50 a R$ 2,00/kWh, margem 10% → para em R$ 45,00 → até 22,5 kWh (mesma regra do servidor).
  await field.fill("50");
  const summary = page.getByRole("definition").filter({ hasText: "R$ 50,00" }).first();
  await expect(summary).toBeVisible();
  const box = page.getByLabel("Resumo antes de pagar");
  await expect(box).toContainText("Reservado agora no meio de pagamento");
  await expect(box).toContainText("R$ 50,00");
  await expect(box).toContainText("R$ 45,00");
  await expect(box).toContainText("até 22,5 kWh");
  await expect(box).toContainText("confirmada no início da recarga");
  await expect(start).toBeEnabled();
  expect(await prisma<number>("chargeRequest", "count", { where: { driverId: f.driverA.driverId } })).toBe(0); // nada foi pedido
});
