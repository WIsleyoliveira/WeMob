import { expect, test } from "@playwright/test";
import { driverLogin, fx, op, prisma, staffLogin } from "./support/helpers";

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

  // 6) Carregador responde "Accepted" mas segue fornecendo energia: NÃO é parada confirmada.
  await prisma("remoteCommand", "updateMany", { where: { stationId: f.station.id, type: "REMOTE_STOP" }, data: { status: "ACCEPTED", completedAt: new Date().toISOString() } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recarga em andamento" })).toBeVisible();

  // 7) Comunicação cai: a tela mostra valores parciais e o aviso.
  await op("markDisconnected", { stationId: f.station.id });
  await page.reload();
  await expect(page.getByText("Carregador sem comunicação")).toBeVisible();

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
