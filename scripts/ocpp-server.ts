import { startOcppServer } from "../src/server/ocpp/ws-server";
import { checkSessionLimit, driverAwareAuthorizer, enforceSessionLimits, expireStaleChargeRequests, onSessionStarted, onSessionStopped } from "../src/server/drivers/charging";
import { retryDueRefunds, retryPendingWebhookEvents } from "../src/server/payments/service";
import { runOperationsCycle } from "../src/server/modules/automation/runner";
import { log } from "../src/server/log";

/** Automações operacionais (alertas, preventiva, tickets de motoristas, notificações) no máximo 1×/min. */
let lastOpsCycle = 0;
/** Limites financeiros das sessões e retentativas de estorno: a cada 15 s. */
let lastMoneyCycle = 0;

const port = Number(process.env.OCPP_PORT ?? 9220);
startOcppServer({
  port,
  authorizer: driverAwareAuthorizer,
  hooks: { onStarted: onSessionStarted, onStopped: onSessionStopped, onMeter: async (id) => void (await checkSessionLimit(id)) },
  onSweep: async () => {
    await expireStaleChargeRequests();
    await retryPendingWebhookEvents();
    if (Date.now() - lastMoneyCycle >= 15_000) {
      lastMoneyCycle = Date.now();
      // Isoladas: uma falha não impede a outra no mesmo ciclo.
      await enforceSessionLimits().catch((e) => log.error("session_limits_cycle_failed", { error: String(e) }));
      await retryDueRefunds().catch((e) => log.error("refund_retry_cycle_failed", { error: String(e) }));
    }
    if (Date.now() - lastOpsCycle >= 60_000) {
      lastOpsCycle = Date.now();
      await runOperationsCycle();
    }
  },
}).then(({ close }) => {
  const stop = () => void close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
