import { notConfiguredProvider, type PaymentProvider } from "./provider";
import { sandboxProvider } from "./sandbox";
import { asaasFromEnv } from "./asaas/provider";
import { readAsaasConfig } from "./asaas/config";

/**
 * Provedores disponíveis: "sandbox" (simulado local, sem dinheiro) e "asaas" (gateway real; ambiente sandbox
 * oficial ou produção conforme ASAAS_ENVIRONMENT). A escolha é só por variável de ambiente no servidor.
 */
export function getProvider(name: string): PaymentProvider {
  if (name === "sandbox") return sandboxProvider;
  if (name === "asaas" && readAsaasConfig().ok) return asaasFromEnv();
  return notConfiguredProvider;
}

/** Provedor ativo para novas cobranças. Configuração incompleta → "não configurado" (nunca um fallback silencioso). */
export function activeProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER === "sandbox") return sandboxProvider;
  if (process.env.PAYMENT_PROVIDER === "asaas") return readAsaasConfig().ok ? asaasFromEnv() : notConfiguredProvider;
  return notConfiguredProvider;
}

/** Motivos de configuração incompleta do provedor selecionado (sem segredos). */
export function providerConfigIssues(): string[] {
  if (process.env.PAYMENT_PROVIDER === "asaas") {
    const r = readAsaasConfig();
    return r.ok ? [] : r.errors;
  }
  return [];
}
