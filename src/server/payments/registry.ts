import { notConfiguredProvider, type PaymentProvider } from "./provider";
import { sandboxProvider } from "./sandbox";

/** Provedores disponíveis. Gateways reais (ex.: Mercado Pago, Pagar.me, Stripe) NÃO estão implementados. */
export function getProvider(name: string): PaymentProvider {
  if (name === "sandbox") return sandboxProvider;
  return notConfiguredProvider;
}

/** Provedor ativo para cobranças. Em ambiente de produção, nenhum provedor real está configurado. */
export function activeProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "sandbox" ? sandboxProvider : notConfiguredProvider;
}
