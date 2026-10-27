/**
 * Carregador SIMULADO contra o servidor OCPP local.
 * Uso: npm run ocpp:simulate -- <ocppIdentity> <senha> [ciclo|interativo] [ws://localhost:9220]
 *  - ciclo: executa uma sessão completa de 15 kWh e mantém conexão por 60 s.
 *  - interativo: fica conectado 10 min; responde a RemoteStart iniciando a transação e enviando
 *    medições (+1 kWh a cada 3 s) e a RemoteStop encerrando-a.
 * Recusa-se a rodar se a estação não estiver cadastrada como SIMULATED.
 */
import { PrismaClient } from "@prisma/client";
import { SimulatedChargePoint } from "../src/server/ocpp/simulator";

const [identity, password, mode = "ciclo", url = "ws://localhost:9220"] = process.argv.slice(2);

async function main() {
  if (!identity || !password) throw new Error("Uso: npm run ocpp:simulate -- <ocppIdentity> <senha> [ciclo|interativo] [url]");
  const db = new PrismaClient();
  const station = await db.chargingStation.findUnique({ where: { ocppIdentity: identity } });
  await db.$disconnect();
  if (!station || station.environment !== "SIMULATED") throw new Error("Recusado: a estação precisa existir e estar no ambiente SIMULATED.");

  const cp = new SimulatedChargePoint(url, identity, password);
  await cp.connect();
  console.log("Boot:", await cp.boot());
  await cp.status(1, "Available");

  if (mode === "interativo") {
    let meter = 200_000;
    let tx: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    cp.onRemote = (action, payload) => {
      if (action === "RemoteStartTransaction" && tx === null) {
        setTimeout(async () => {
          await cp.status(1, "Preparing");
          const r = await cp.start(1, String(payload.idTag), meter);
          console.log("StartTransaction:", r);
          if (r.idTagInfo.status !== "Accepted") return void (await cp.status(1, "Available"));
          tx = r.transactionId;
          await cp.status(1, "Charging");
          timer = setInterval(() => {
            meter += 1000;
            void cp.meter(1, tx!, meter);
          }, 3000);
        }, 500);
        return { status: "Accepted" };
      }
      if (action === "RemoteStopTransaction" && tx !== null && payload.transactionId === tx) {
        setTimeout(async () => {
          clearInterval(timer);
          await cp.stop(tx!, meter, new Date(), "Remote");
          console.log("StopTransaction enviado; medidor", meter);
          tx = null;
          await cp.status(1, "Finishing");
          await cp.status(1, "Available");
        }, 500);
        return { status: "Accepted" };
      }
      return action === "UnlockConnector" ? { status: "Unlocked" } : { status: action.startsWith("Remote") ? "Rejected" : "Accepted" };
    };
    setInterval(() => void cp.call("Heartbeat", {}), 30_000);
    console.log("Modo interativo: aguardando comandos por 10 min.");
    setTimeout(() => void cp.close().then(() => process.exit(0)), 10 * 60_000);
    return;
  }

  await cp.status(1, "Preparing");
  const tx = await cp.start(1, "SIM-0001", 100000);
  console.log("StartTransaction:", tx);
  await cp.status(1, "Charging");
  for (let i = 1; i <= 3; i++) {
    await cp.meter(1, tx.transactionId, 100000 + i * 5000);
    await new Promise((r) => setTimeout(r, 500));
  }
  await cp.stop(tx.transactionId, 115000);
  await cp.status(1, "Finishing");
  await cp.status(1, "Available");
  console.log("Sessão simulada concluída: 15 kWh. Mantendo conexão por 60 s para receber comandos (Ctrl+C para sair).");
  setTimeout(() => void cp.close().then(() => process.exit(0)), 60_000);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
