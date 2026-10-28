/**
 * Gerencia webhooks da conta Asaas do SANDBOX (homologação/staging). Recusa produção.
 * O token de autenticação é sempre ASAAS_WEBHOOK_TOKEN do .env — nunca impresso nem aceito por argumento.
 *
 *   npm run asaas:webhook -- listar
 *   npm run asaas:webhook -- criar https://<host-publico> [--email=alguem@exemplo.com]
 *   npm run asaas:webhook -- atualizar <id> https://<novo-host>   (mantém a fila de eventos pendentes)
 *   npm run asaas:webhook -- remover <id>
 * A URL recebe o caminho /api/payments/webhooks/asaas. Envio NON_SEQUENTIALLY: a WeMob sempre consulta o estado real.
 */
import { readAsaasConfig } from "../src/server/payments/asaas/config";
import { createAsaasProvider } from "../src/server/payments/asaas/provider";
import { ASAAS_EVENT_EXPECTATION } from "../src/domain/payments/asaas";

type Hook = { id: string; name: string; url: string; enabled: boolean; interrupted: boolean; sendType: string; events: string[]; penalizedRequestsCount?: number };

async function main() {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const email = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1] ?? "webhook-homologacao@example.com";
  const cfg = readAsaasConfig();
  if (!cfg.ok) throw new Error(`Configuração do Asaas incompleta: ${cfg.errors.join(" ")}`);
  if (cfg.config.environment !== "SANDBOX") throw new Error("Recusado: este script só gerencia webhooks do sandbox.");
  const { client } = createAsaasProvider(cfg.config);
  const show = (h: Hook) => ({ id: h.id, name: h.name, url: h.url, enabled: h.enabled, interrupted: h.interrupted, sendType: h.sendType, eventos: h.events?.length, penalizacoes: h.penalizedRequestsCount ?? null });

  if (cmd === "listar") {
    const r = await client.request<{ data: Hook[] }>("GET", "/webhooks", undefined, { limit: 100 });
    console.log(JSON.stringify(r.data.map(show), null, 2));
  } else if (cmd === "criar") {
    const u = new URL(arg ?? "");
    if (u.protocol !== "https:") throw new Error("A URL pública precisa ser HTTPS.");
    const body = {
      name: `WeMob homologação ${new Date().toISOString().slice(0, 16)}`,
      url: `${u.origin}/api/payments/webhooks/asaas`,
      email,
      enabled: true,
      interrupted: false,
      sendType: "NON_SEQUENTIALLY",
      authToken: process.env.ASAAS_WEBHOOK_TOKEN,
      events: Object.keys(ASAAS_EVENT_EXPECTATION),
    };
    const h = await client.request<Hook>("POST", "/webhooks", body);
    console.log(JSON.stringify(show(h), null, 2));
  } else if (cmd === "atualizar") {
    const target = process.argv.slice(2).filter((a) => !a.startsWith("--"))[2];
    const u = new URL(target ?? "");
    if (!arg || u.protocol !== "https:") throw new Error("Uso: atualizar <id> <url-https>");
    const h = await client.request<Hook>("PUT", `/webhooks/${encodeURIComponent(arg)}`, { url: `${u.origin}/api/payments/webhooks/asaas`, enabled: true, interrupted: false });
    console.log(JSON.stringify(show(h), null, 2));
  } else if (cmd === "remover") {
    if (!arg) throw new Error("Informe o id do webhook.");
    console.log(JSON.stringify(await client.request("DELETE", `/webhooks/${encodeURIComponent(arg)}`)));
  } else {
    throw new Error("Uso: listar | criar <url-https> [--email=] | atualizar <id> <url-https> | remover <id>");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
