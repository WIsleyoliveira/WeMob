import { startOcppServer } from "../src/server/ocpp/ws-server";
import { driverAwareAuthorizer, expireStaleChargeRequests, onSessionStarted, onSessionStopped } from "../src/server/drivers/charging";
import { retryPendingWebhookEvents } from "../src/server/payments/service";
import { runOperationsCycle } from "../src/server/modules/automation/runner";

/** Automações operacionais (alertas, preventiva, tickets de motoristas, notificações) no máximo 1×/min. */
let lastOpsCycle = 0;

const port = Number(process.env.OCPP_PORT ?? 9220);
startOcppServer({
  port,
  authorizer: driverAwareAuthorizer,
  hooks: { onStarted: onSessionStarted, onStopped: onSessionStopped },
  onSweep: async () => {
    await expireStaleChargeRequests();
    await retryPendingWebhookEvents();
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
