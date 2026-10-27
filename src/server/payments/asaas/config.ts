/**
 * Configuração do Asaas, lida SOMENTE de variáveis de ambiente no servidor. Nenhuma requisição altera o
 * gateway ou habilita produção. Produção exige ambiente "production", chave de produção E
 * ASAAS_PRODUCTION_ENABLED=1 — e, além disso, aprovação registrada na plataforma (ver activation.ts).
 * URLs conforme docs.asaas.com/docs/autenticação-1 (consultado em 2026-10-27).
 */
export const ASAAS_BASE_URL = { SANDBOX: "https://api-sandbox.asaas.com/v3", PRODUCTION: "https://api.asaas.com/v3" } as const;

export interface AsaasConfig {
  environment: "SANDBOX" | "PRODUCTION";
  baseUrl: string;
  apiKey: string;
  webhookToken: string;
  userAgent: string;
  splitEnabled: boolean;
  ownWalletId: string | null;
  timeoutMs: number;
}

export type AsaasConfigResult = { ok: true; config: AsaasConfig } | { ok: false; environment: "SANDBOX" | "PRODUCTION" | null; errors: string[] };

export function readAsaasConfig(env: NodeJS.ProcessEnv = process.env): AsaasConfigResult {
  const errors: string[] = [];
  const envName = (env.ASAAS_ENVIRONMENT ?? "").toLowerCase();
  const environment = envName === "production" ? "PRODUCTION" : envName === "sandbox" ? "SANDBOX" : null;
  if (!environment) errors.push('ASAAS_ENVIRONMENT deve ser "sandbox" ou "production".');
  const apiKey = environment === "PRODUCTION" ? env.ASAAS_PRODUCTION_API_KEY : env.ASAAS_SANDBOX_API_KEY;
  if (environment && !apiKey) errors.push(`${environment === "PRODUCTION" ? "ASAAS_PRODUCTION_API_KEY" : "ASAAS_SANDBOX_API_KEY"} não configurada.`);
  if (environment === "PRODUCTION" && env.ASAAS_PRODUCTION_ENABLED !== "1") errors.push("Produção não habilitada: defina ASAAS_PRODUCTION_ENABLED=1 somente após a homologação aprovada.");
  if (environment === "PRODUCTION" && env.NODE_ENV === "test") errors.push("Chave de produção não pode ser usada em testes automatizados.");
  const webhookToken = env.ASAAS_WEBHOOK_TOKEN ?? "";
  if (webhookToken.length < 32) errors.push("ASAAS_WEBHOOK_TOKEN ausente ou curto (mínimo 32 caracteres; não use a chave de API).");
  if (webhookToken && apiKey && webhookToken === apiKey) errors.push("ASAAS_WEBHOOK_TOKEN não pode ser igual à chave de API.");
  const ownWalletId = env.ASAAS_OWN_WALLET_ID?.trim() || null;
  if (errors.length || !environment || !apiKey) return { ok: false, environment, errors };
  return {
    ok: true,
    config: {
      environment,
      baseUrl: ASAAS_BASE_URL[environment],
      apiKey,
      webhookToken,
      userAgent: env.ASAAS_USER_AGENT?.trim() || "WeMob-SansolMob/1.0",
      splitEnabled: env.ASAAS_SPLIT_ENABLED === "1",
      ownWalletId,
      timeoutMs: Math.min(60_000, Math.max(2_000, Number(env.ASAAS_TIMEOUT_MS ?? 15_000) || 15_000)),
    },
  };
}

/** Resumo exibível (sem segredos). */
export function asaasConfigSummary(env: NodeJS.ProcessEnv = process.env) {
  const r = readAsaasConfig(env);
  if (!r.ok) return { selected: env.PAYMENT_PROVIDER === "asaas", configured: false, environment: r.environment, errors: r.errors, splitEnabled: env.ASAAS_SPLIT_ENABLED === "1" };
  return { selected: env.PAYMENT_PROVIDER === "asaas", configured: true, environment: r.config.environment, errors: [] as string[], splitEnabled: r.config.splitEnabled, baseUrl: r.config.baseUrl, ownWalletConfigured: !!r.config.ownWalletId };
}
