/**
 * Executor de operações do E2E (processo separado, via tsx): o Playwright não carrega o código do app.
 *   tsx e2e/support/ops.ts <operação> '<json>'   → imprime o resultado em JSON na última linha.
 * Só roda no banco E2E temporário.
 */
import { db } from "@/server/db";

type Args = Record<string, unknown>;

const ops: Record<string, (a: Args) => Promise<unknown>> = {
  /** Consulta/escrita genérica do Prisma: { model, method, args }. */
  async prisma(a) {
    const model = (db as unknown as Record<string, Record<string, (x: unknown) => Promise<unknown>>>)[String(a.model)];
    const method = String(a.method);
    if (!model || !["count", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany", "create", "update", "updateMany"].includes(method)) throw new Error("operação Prisma não permitida");
    return model[method](a.args ?? {});
  },
  /** Mensagem do carregador simulado pelo mesmo handler do servidor OCPP (com os ganchos do fluxo de recarga). */
  async ocpp(a) {
    const { handleCall } = await import("@/server/ocpp/handler");
    const { checkSessionLimit, driverAwareAuthorizer, onSessionStarted, onSessionStopped } = await import("@/server/drivers/charging");
    const station = await db.chargingStation.update({ where: { id: String(a.stationId) }, data: { lastSeenAt: new Date(), connectionState: "CONNECTED" } });
    const hooks = { onStarted: onSessionStarted, onStopped: onSessionStopped, onMeter: async (id: string) => void (await checkSessionLimit(id)) };
    return handleCall(station, `e2e-${a.action}-${Date.now()}-${Math.random()}`, String(a.action), a.payload, { authorizer: driverAwareAuthorizer, hooks });
  },
  async markDisconnected(a) {
    const { markDisconnected } = await import("@/server/ocpp/handler");
    await markDisconnected(String(a.stationId));
    return true;
  },
  async retryDueRefunds() {
    const { retryDueRefunds } = await import("@/server/payments/service");
    return retryDueRefunds(new Date());
  },
  async evaluateAlerts(a) {
    const { evaluateAlerts } = await import("@/server/modules/alerts/engine");
    return evaluateAlerts(String(a.operatorId), new Date(Date.now() + Number(a.offsetMs ?? 0)));
  },
};

async function main() {
  if (!process.env.DATABASE_URL?.includes("sansol_e2e_")) throw new Error("ops do E2E só rodam no banco E2E temporário.");
  const [name, json] = process.argv.slice(2);
  const fn = ops[name];
  if (!fn) throw new Error(`operação desconhecida: ${name}`);
  const out = await fn(json ? JSON.parse(json) : {});
  process.stdout.write(`\n${JSON.stringify(out ?? null)}\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
