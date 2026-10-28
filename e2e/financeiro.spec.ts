import { expect, test } from "@playwright/test";
import { fx, op, prisma, staffLogin } from "./support/helpers";

/** Gateway: provedor local SIMULADO (sandbox) no banco temporário — nenhum valor real. */
test.describe("B. fluxo financeiro (gateway simulado)", () => {
  test("cobrança capturada é exibida com valores e estado corretos", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.refund}`);
    await expect(page.getByRole("heading", { name: "Pagamento capturado" })).toBeVisible();
    await expect(page.getByText(/Disponível: R\$\s?50,00/)).toBeVisible();
  });

  test("estorno pela tela: clique duplo no envio gera UM estorno, confirmado pelo gateway", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.refund}`);
    await page.getByLabel("Valor (R$)").fill("10,00");
    await page.getByLabel("Motivo").fill("Diferença não consumida (E2E)");
    await page.getByRole("button", { name: "Solicitar reembolso", exact: true }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Solicitar reembolso", exact: true });
    await confirm.dblclick(); // dois cliques rápidos na confirmação
    await expect(page.getByText("Estorno confirmado pelo provedor.")).toBeVisible();
    expect(await prisma("refund", "count", { where: { paymentId: f.payments.refund } })).toBe(1);
    const charge = await prisma<{ refunded: string }>("sandboxGatewayCharge", "findUniqueOrThrow", { where: { id: f.sandboxRefs.refund } });
    expect(Number(charge.refunded)).toBe(10);
    await page.reload();
    await expect(page.getByText(/Disponível: R\$\s?40,00/)).toBeVisible();
  });

  test("estorno acima do disponível é recusado sem chamar o gateway", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.refund}`);
    await page.getByLabel("Valor (R$)").fill("999");
    await page.getByLabel("Motivo").fill("Valor acima do pago (E2E)");
    await page.getByRole("button", { name: "Solicitar reembolso", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Solicitar reembolso", exact: true }).click();
    await expect(page.getByText(/Valor acima do disponível/)).toBeVisible();
    expect(await prisma("refund", "count", { where: { paymentId: f.payments.refund, amount: 999 } })).toBe(0);
  });

  test("estados do estorno: pendente, incerto, aguardando autorização e recusado aparecem distintos; saldo desconta os em andamento", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.states}`);
    const table = page.locator("table").filter({ hasText: "E2E pendente" });
    await expect(table.getByRole("row").filter({ hasText: "E2E pendente" })).toContainText("aguardando gateway");
    await expect(table.getByRole("row").filter({ hasText: "E2E incerto" })).toContainText("resultado incerto");
    await expect(table.getByRole("row").filter({ hasText: "E2E autorizacao" })).toContainText("autorizar no painel do Asaas");
    await expect(table.getByRole("row").filter({ hasText: "E2E recusado" })).toContainText("falhou");
    // 40 pagos − (5 + 6 + 7) em andamento = 22 (o recusado não compromete o saldo)
    await expect(page.getByText(/Disponível: R\$\s?22,00/)).toBeVisible();
  });
});

test.describe("D. regressões P16–P18", () => {
  test("P18: estorno agendado pelo gateway para o futuro não oferece 'Tentar agora'", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.scheduledFuture}`);
    const row = page.getByRole("row").filter({ hasText: "E2E agendado futuro" });
    await expect(row).toContainText("agendado (nova tentativa)");
    await expect(row).toContainText("próximo dia");
    await expect(row.getByRole("button", { name: "Tentar agora" })).toHaveCount(0);
  });

  test("P17: 'Tentar agora' (navegador) concorrendo com a retentativa automática (outro processo) devolve UMA vez", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto(`/app/pagamentos/${f.payments.scheduledDue}`);
    const row = page.getByRole("row").filter({ hasText: "E2E agendado vencido" });
    const auto = op("retryDueRefunds"); // ciclo automático em OUTRO processo…
    const click = row.getByRole("button", { name: "Tentar agora" }).click(); // …e a equipe clica ao mesmo tempo
    await Promise.all([click, auto]);
    const refund = () => prisma<{ status: string; attempts: number }>("refund", "findFirstOrThrow", { where: { paymentId: f.payments.scheduledDue } });
    await expect.poll(async () => (await refund()).status, { timeout: 30_000 }).toBe("SUCCEEDED");
    const charge = await prisma<{ refunded: string }>("sandboxGatewayCharge", "findUniqueOrThrow", { where: { id: f.sandboxRefs.scheduledDue } });
    expect(Number(charge.refunded)).toBe(10); // um único estorno no gateway
    expect((await refund()).attempts).toBe(2); // recusa original + 1 retentativa
  });

  test("P18: split recusado aparece na conciliação pela tela", async ({ page }) => {
    const f = fx();
    await staffLogin(page, f.finance);
    await page.goto("/app/pagamentos");
    await page.getByRole("button", { name: "Conciliar período" }).click();
    await expect(page.getByText(/recusado pelo gateway: repasse não realizado/)).toBeVisible({ timeout: 45_000 }); // a conciliação consulta o gateway pagamento a pagamento
  });

  test("perfil financeiro não administra usuários (sem permissão)", async ({ page }) => {
    await staffLogin(page, fx().finance);
    await page.goto("/app/usuarios");
    await expect(page).toHaveURL(/\/app\/sem-permissao/);
  });
});
