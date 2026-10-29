import { expect, test } from "@playwright/test";
import { driverLogin, fx, op, prisma, staffLogin, submitConfirmed } from "./support/helpers";

/**
 * Recarga ponta a ponta: o motorista age no NAVEGADOR; o carregador é SIMULADO pelo mesmo handler OCPP do servidor
 * (StartTransaction/MeterValues/StopTransaction), com o gateway local simulado (pré-autorização de R$ 50, limite R$ 45).
 * Não há carregador físico nem gateway real.
 */
test("C. recarga: início, consumo, barra e alerta de limite, parada aceita ≠ parada confirmada, sem comunicação, sem telemetria", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const f = fx();
  const charger = (action: string, payload: unknown) => op<{ result: Record<string, unknown> }>("ocpp", { stationId: f.station.id, action, payload });
  const stopCommands = () => prisma<number>("remoteCommand", "count", { where: { stationId: f.station.id, type: "REMOTE_STOP" } });

  // 1) Motorista pede a recarga pelo navegador.
  await driverLogin(page, f.driverA);
  await page.goto(`/motorista/estacoes/${f.station.identity}`);
  await page.getByRole("button", { name: "Iniciar recarga" }).click();
  await expect(page).toHaveURL(/\/motorista\/pedido\//);
  await expect(page.getByRole("heading", { name: "Aguardando o carregador iniciar" })).toBeVisible();
  const tag = await prisma<{ idTag: string }>("driverIdTag", "findFirstOrThrow", { where: { driverId: f.driverA.driverId } });
  expect(await prisma("remoteCommand", "count", { where: { stationId: f.station.id, type: "REMOTE_START" } })).toBe(1);
  // P23 B1: ordem enviada ≠ ordem aceita ≠ recarga iniciada.
  await expect(page.getByText("Estamos enviando a ordem de início ao carregador")).toBeVisible();
  await prisma("remoteCommand", "updateMany", { where: { stationId: f.station.id, type: "REMOTE_START" }, data: { status: "ACCEPTED", completedAt: new Date().toISOString() } });
  await page.reload();
  await expect(page.getByText("O carregador aceitou a ordem de início. Aguardando o início efetivo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aguardando o carregador iniciar" })).toBeVisible();

  // 2) Carregador inicia; a tela vira "Recarga em andamento" com o limite.
  const start = await charger("StartTransaction", { connectorId: 1, idTag: tag.idTag, meterStart: 0, timestamp: new Date().toISOString() });
  const tx = Number(start.result.transactionId);
  const meter = (wh: number) => charger("MeterValues", { connectorId: 1, transactionId: tx, meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: String(wh) }] }] });
  await page.reload();
  await expect(page).toHaveURL(/\/motorista\/recarga\//);
  await expect(page.getByRole("heading", { name: "Recarga em andamento" })).toBeVisible();
  await expect(page.getByText("Limite desta recarga")).toBeVisible();
  await expect(page.getByText("R$ 45,00")).toBeVisible();

  // 3) Consumo: 10 kWh × R$ 2 = R$ 20 → barra parcial.
  await meter(10_000);
  await page.reload();
  await expect(page.getByText("R$ 20,00")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Uso do limite" })).toHaveAttribute("aria-valuenow", "44");

  // 4) 21 kWh = R$ 42 (≥ 90% de R$ 45) → alerta na tela da equipe.
  await meter(21_000);
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await staffLogin(staff, f.admin);
  await staff.goto("/app/alertas");
  await staff.getByRole("button", { name: "Executar avaliação agora" }).click();
  await expect(staff.getByText(/perto do limite financeiro/)).toBeVisible();

  // 5) 23 kWh = R$ 46 → limite atingido: UMA ordem de parada; a tela avisa, a recarga segue "em andamento".
  await meter(23_000);
  await meter(23_100);
  expect(await stopCommands()).toBe(1);
  await page.reload();
  await expect(page.getByText("Limite atingido: pedimos ao carregador para encerrar a recarga.")).toBeVisible();
  await expect(page.getByText("Solicitação de encerramento enviada ao carregador.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Encerrar recarga" })).toHaveCount(0); // sem segundo pedido em paralelo

  // 6) Carregador responde "Accepted" mas segue fornecendo energia: NÃO é parada confirmada.
  await prisma("remoteCommand", "updateMany", { where: { stationId: f.station.id, type: "REMOTE_STOP" }, data: { status: "ACCEPTED", completedAt: new Date().toISOString() } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recarga em andamento" })).toBeVisible();
  await expect(page.getByText("O carregador aceitou o encerramento. Aguardando a confirmação final")).toBeVisible();

  // 7) Comunicação cai: a tela mostra valores parciais e o aviso.
  await op("markDisconnected", { stationId: f.station.id });
  await page.reload();
  await expect(page.getByText("Carregador sem comunicação")).toBeVisible();
  await expect(page.getByText(/Última comunicação: /)).toBeVisible();

  // 8) Sem telemetria e parada não confirmada (20 min depois): alertas de contingência na tela da equipe.
  await op("evaluateAlerts", { operatorId: f.operatorId, offsetMs: 20 * 60_000 });
  await staff.goto("/app/alertas");
  await expect(staff.getByText(/parada NÃO confirmada/)).toBeVisible();
  await expect(staff.getByText(/sem leitura do medidor há mais de 15 min/)).toBeVisible();

  // 9) Carregador volta e encerra: tela "Recarga encerrada"; captura dentro da pré-autorização.
  await charger("StopTransaction", { transactionId: tx, meterStop: 23_200, timestamp: new Date().toISOString(), reason: "Remote" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recarga encerrada" })).toBeVisible();
  const s = await prisma<{ amount: string; payments: { amountCaptured: string }[] }>("chargingSession", "findFirstOrThrow", { where: { stationId: f.station.id, transactionId: tx }, include: { payments: true } });
  expect(Number(s.amount)).toBe(46.4);
  expect(Number(s.payments[0].amountCaptured)).toBe(46.4);
  await staffCtx.close();
});

test("P23 B1: encerramento pedido pelo motorista continua visível ao recarregar a página e só vira 'encerrada' com a confirmação do carregador", async ({ page }) => {
  test.setTimeout(90_000);
  const f = fx();
  const charger = (action: string, payload: unknown) => op<{ result: Record<string, unknown> }>("ocpp", { stationId: f.station.id, action, payload });
  const stops = () => prisma<{ id: string; status: string }[]>("remoteCommand", "findMany", { where: { stationId: f.station.id, type: "REMOTE_STOP" }, orderBy: { createdAt: "asc" } });
  const before = (await stops()).length;
  // Carregador de volta e livre após o teste anterior.
  await charger("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available", timestamp: new Date().toISOString() });

  await driverLogin(page, f.driverB);
  await page.goto(`/motorista/estacoes/${f.station.identity}`);
  await page.getByRole("button", { name: "Iniciar recarga" }).click();
  await expect(page).toHaveURL(/\/motorista\/pedido\//);
  const tag = await prisma<{ idTag: string }>("driverIdTag", "findFirstOrThrow", { where: { driverId: f.driverB.driverId } });
  const start = await charger("StartTransaction", { connectorId: 1, idTag: tag.idTag, meterStart: 0, timestamp: new Date().toISOString() });
  const tx = Number(start.result.transactionId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recarga em andamento" })).toBeVisible();
  await expect(page.getByText("Nenhuma medição recebida do carregador até agora.")).toBeVisible();

  await submitConfirmed(page, "Encerrar recarga");
  // A tela passa direto ao estado gravado (o formulário some: não há segundo pedido em paralelo).
  await expect(page.getByText("Solicitação de encerramento enviada ao carregador.")).toBeVisible();
  await page.reload(); // o estado vem do comando gravado, não da resposta do botão
  await expect(page.getByText("Solicitação de encerramento enviada ao carregador.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recarga em andamento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Encerrar recarga" })).toHaveCount(0);
  const mine = (await stops()).slice(before);
  expect(mine).toHaveLength(1);

  // Carregador recusa: o motorista pode pedir de novo (um novo comando, não dois em paralelo).
  await prisma("remoteCommand", "update", { where: { id: mine[0].id }, data: { status: "REJECTED", completedAt: new Date().toISOString() } });
  await page.reload();
  await expect(page.getByText("O carregador não confirmou o pedido de encerramento.")).toBeVisible();
  await submitConfirmed(page, "Pedir o encerramento de novo");
  await expect(page.getByText("Solicitação de encerramento enviada ao carregador.")).toBeVisible();
  expect((await stops()).slice(before)).toHaveLength(2);

  await charger("StopTransaction", { transactionId: tx, meterStop: 1_500, timestamp: new Date().toISOString(), reason: "Remote" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recarga encerrada" })).toBeVisible();
  await expect(page.getByText("Solicitação de encerramento enviada")).toHaveCount(0);
});
