/**
 * Roda um ciclo de recarga SIMULADO contra o servidor OCPP local.
 * Uso: npm run ocpp:simulate -- <ocppIdentity> <senha> [ws://localhost:9220]
 * Recusa-se a rodar se a estação não estiver cadastrada como SIMULATED.
 */
import { PrismaClient } from "@prisma/client";
import { SimulatedChargePoint } from "../src/server/ocpp/simulator";

const [identity, password, url = "ws://localhost:9220"] = process.argv.slice(2);
if (!identity || !password) {
  console.error("Uso: npm run ocpp:simulate -- <ocppIdentity> <senha> [url]");
  process.exit(1);
}
async function main() {
  const db = new PrismaClient();
  const station = await db.chargingStation.findUnique({ where: { ocppIdentity: identity } });
  await db.$disconnect();
  if (!station || station.environment !== "SIMULATED") {
    console.error("Recusado: a estação precisa existir e estar no ambiente SIMULATED.");
    process.exit(1);
  }
  const cp = new SimulatedChargePoint(url, identity, password);
  await cp.connect();
  console.log("Boot:", await cp.boot());
  await cp.status(1, "Available");
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
