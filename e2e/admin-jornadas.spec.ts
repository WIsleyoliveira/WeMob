import { expect, test } from "@playwright/test";
import { fx, prisma, staffLogin, submitConfirmed } from "./support/helpers";

/**
 * Jornadas administrativas de ponta a ponta no navegador (banco E2E temporário, nenhum dado real).
 * Um login por perfil: o login da equipe tem limite de 10 tentativas por conta a cada 15 minutos.
 */
test("jornadas administrativas: lead → proposta → contrato com aprovação por duas pessoas → chamado → OS → usuários → auditoria", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const f = fx();
  await staffLogin(page, f.admin);

  // 1) Criar e editar oportunidade
  await page.goto("/app/crm/novo");
  await page.getByLabel("Nome do contato").fill("Contato Jornada E2E");
  await page.getByLabel("E-mail").fill("jornada.e2e@teste.local");
  await page.getByLabel("Empresa").fill("Posto Jornada (E2E)");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page).toHaveURL(/\/app\/crm\/c[a-z0-9]+$/);
  const leadUrl = page.url();
  await page.getByLabel("Valor estimado (R$)").fill("150000");
  await page.getByRole("button", { name: "Salvar qualificação" }).click();
  await expect(page.getByText(/salv/i).first()).toBeVisible();
  const lead = await prisma<{ estimatedValue: string | null }>("lead", "findFirstOrThrow", { where: { email: "jornada.e2e@teste.local" } });
  expect(Number(lead.estimatedValue)).toBe(150000);
  await page.goto("/app/crm?view=lista&q=Jornada");
  await expect(page.getByRole("table").getByRole("link", { name: "Posto Jornada (E2E)" })).toBeVisible();

  // 2) Gerar proposta
  await page.goto(leadUrl);
  await page.getByRole("link", { name: "Nova proposta" }).click();
  await page.getByLabel("Título").fill("Proposta Jornada E2E");
  await page.getByLabel("Descrição").first().fill("Implantação de eletroposto");
  await page.getByLabel("Valor unit. (R$)").fill("150000");
  await page.getByLabel("Válida até").fill("2026-12-31");
  await page.getByLabel("Condições comerciais").fill("Participação 30/70 sobre o faturamento bruto. Sujeito a contrato.");
  await page.getByRole("button", { name: "Criar proposta (v1)" }).click();
  await expect(page).toHaveURL(/\/app\/crm\/propostas\/c/);
  await page.goto("/app/crm/propostas?q=Jornada");
  await expect(page.getByRole("table", { name: "Propostas" })).toContainText("Proposta Jornada E2E");
  await expect(page.getByRole("list", { name: "Resumo das propostas" })).toContainText("Rascunhos");

  // 3) Criar contrato (30/70) — quem cria não aprova
  await page.goto("/app/contratos/novo");
  await page.getByLabel("Parceiro / investidor").selectOption({ label: "Parceiro A (E2E) (parceiro)" });
  await page.getByLabel("Título").fill("Contrato Jornada (E2E)");
  await page.getByRole("checkbox", { name: /Posto A \(E2E\)/ }).check();
  await page.getByLabel("Início da vigência").fill("2026-12-01");
  await page.getByLabel("Condições (texto contratual)").fill("WeMob 30% / posto 70% do faturamento bruto mensal.");
  await page.getByLabel(/Motivo/).fill("Contrato da jornada E2E.");
  await page.getByRole("button", { name: "Criar contrato (rascunho)" }).click();
  await expect(page).toHaveURL(/\/app\/contratos\/c/);
  const contractUrl = page.url();
  await expect(page.getByText("Versão 1 aguardando aprovação")).toBeVisible();
  await expect(page.getByText(/Você criou esta versão: a decisão cabe a outra pessoa autorizada/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar versão" })).toHaveCount(0);
  await page.goto("/app/contratos?pendente=1");
  await expect(page.getByRole("table", { name: "Contratos" })).toContainText("Contrato Jornada (E2E)");

  // 4) Aprovar por outra pessoa (perfil financeiro)
  const finCtx = await browser.newContext();
  const fin = await finCtx.newPage();
  await staffLogin(fin, f.finance);
  await fin.goto(contractUrl);
  await submitConfirmed(fin, "Aprovar versão");
  // espera a decisão gravar (o botão vira "Salvando…" e a seção do rascunho sai da tela depois)
  await expect.poll(async () => (await prisma<{ status: string }>("contractVersion", "findFirstOrThrow", { where: { contract: { title: "Contrato Jornada (E2E)" } } })).status, { timeout: 15_000 }).toBe("APPROVED");
  await fin.reload();
  await expect(fin.getByText("Versão 1 aguardando aprovação")).toHaveCount(0);
  await expect(fin.getByText("vigente").first()).toBeVisible();
  await finCtx.close();
  const version = await prisma<{ status: string; createdById: string; decidedById: string }>("contractVersion", "findFirstOrThrow", { where: { contract: { title: "Contrato Jornada (E2E)" } } });
  expect(version.status).toBe("APPROVED");
  expect(version.decidedById).not.toBe(version.createdById); // duas pessoas

  // 5) Abrir e resolver chamado
  await page.goto("/app/suporte/novo");
  await page.getByLabel("Título").fill("Carregador não inicia (E2E)");
  await page.getByLabel("Descrição").fill("O conector 1 não inicia a recarga depois do pagamento.");
  await page.getByRole("button", { name: "Abrir ticket" }).click();
  await expect(page).toHaveURL(/\/app\/suporte\/c/);
  await page.getByLabel("Novo status").selectOption({ label: "Resolvido" });
  await page.getByLabel("Motivo ou solução").fill("Reinicializado pelo técnico; recarga testada.");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Resolvido").first()).toBeVisible();
  const ticket = await prisma<{ status: string }>("ticket", "findFirstOrThrow", { where: { title: "Carregador não inicia (E2E)" } });
  expect(ticket.status).toBe("RESOLVED");
  await page.goto("/app/suporte?status=done&q=E2E");
  await expect(page.getByRole("table", { name: "Chamados" })).toContainText("Carregador não inicia (E2E)");

  // 6) Registrar manutenção
  await page.goto("/app/manutencao");
  await page.getByText("+ Nova OS corretiva").click();
  const novaOs = page.locator("#nova-os");
  await novaOs.getByLabel("Título").fill("Conector 1 não trava o cabo (E2E)");
  await novaOs.getByLabel("Checklist (um item por linha)").fill("Inspecionar trava\nTestar recarga");
  await novaOs.getByRole("button", { name: "Abrir OS" }).click();
  await expect.poll(() => prisma<number>("workOrder", "count", { where: { title: "Conector 1 não trava o cabo (E2E)" } }), { timeout: 15_000 }).toBe(1);
  await page.goto("/app/manutencao?q=trava");
  await expect(page.getByRole("table", { name: "Ordens de serviço" })).toContainText("Conector 1 não trava o cabo (E2E)");

  // 7) Gerenciar usuários e permissões: trocar o perfil (e voltar), com salvaguardas
  await page.goto("/app/usuarios?q=finance");
  const row = page.getByRole("row").filter({ hasText: f.finance.email });
  await row.getByText("Gerenciar").click();
  await row.getByLabel("Perfil").selectOption({ label: "Comercial" });
  await row.getByRole("button", { name: "Trocar perfil" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Trocar perfil" }).click();
  await expect(page.getByText(/Perfil alterado/)).toBeVisible();
  await page.goto("/app/usuarios?q=finance");
  await expect(page.getByRole("row").filter({ hasText: f.finance.email })).toContainText("Comercial");
  const row2 = page.getByRole("row").filter({ hasText: f.finance.email });
  await row2.getByText("Gerenciar").click();
  await row2.getByLabel("Perfil").selectOption({ label: "Financeiro" });
  await row2.getByRole("button", { name: "Trocar perfil" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Trocar perfil" }).click();
  await expect(page.getByText(/Perfil alterado/)).toBeVisible();
  // a própria linha não tem "Gerenciar" (ninguém altera o próprio perfil)
  await page.goto("/app/usuarios");
  await expect(page.getByRole("row").filter({ hasText: f.admin.email }).getByText("Gerenciar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Perfis e permissões" })).toBeVisible();

  // 8) Consultar histórico de auditoria
  await page.goto("/app/auditoria?area=Contratos");
  await expect(page.getByRole("table", { name: "Registros de auditoria" })).toContainText("Aprovou versão de contrato");
  await page.goto("/app/auditoria?area=Usu%C3%A1rios");
  await expect(page.getByRole("table", { name: "Registros de auditoria" })).toContainText("Alterou o perfil de usuário");
  await page.goto("/app/auditoria");
  await expect(page.getByRole("navigation", { name: "Paginação" })).toContainText(/de \d+ registros/);
});
