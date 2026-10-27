/**
 * Contrato de provedor de pagamento (gateway). A aplicação nunca considera um pagamento
 * concluído pela resposta do navegador: o status vem do provedor (consulta ou webhook verificado).
 */
export type ProviderStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED" | "CANCELLED" | "DISPUTED";

export interface ProviderPayment {
  providerRef: string;
  status: ProviderStatus;
  amountAuthorized: string;
  amountCaptured: string;
  amountRefunded: string;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly environment: "SANDBOX" | "PRODUCTION";
  readonly status: "configured" | "not_configured";
  /** Pré-autorização (reserva) do valor máximo da recarga. */
  authorize(amount: string, metadata: Record<string, string>): Promise<ProviderPayment>;
  capture(providerRef: string, amount: string): Promise<ProviderPayment>;
  cancel(providerRef: string): Promise<ProviderPayment>;
  refund(providerRef: string, amount: string): Promise<ProviderPayment>;
  /** Fonte de verdade do status. */
  fetch(providerRef: string): Promise<ProviderPayment>;
  /** Verifica assinatura e extrai o evento. Lança erro se inválido. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent;
}

export class ProviderUnavailableError extends Error {}

/** Nenhum gateway real contratado: todas as operações falham explicitamente. */
export const notConfiguredProvider: PaymentProvider = {
  name: "none",
  environment: "PRODUCTION",
  status: "not_configured",
  authorize: async () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
  capture: async () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
  cancel: async () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
  refund: async () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
  fetch: async () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
  parseWebhook: () => { throw new ProviderUnavailableError("Gateway de pagamento não configurado."); },
};
