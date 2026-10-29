/**
 * Contrato de provedor de pagamento (gateway). A aplicação nunca considera um pagamento
 * concluído pela resposta do navegador: o status vem do provedor (consulta ou webhook verificado).
 */
export type ProviderStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED" | "CANCELLED" | "DISPUTED";

export interface ProviderRefund {
  status: string;
  value: string;
  description?: string | null;
}

export interface ProviderSplit {
  remoteId?: string | null;
  walletId: string;
  status: string;
  totalValue?: string | null;
  externalReference?: string | null;
  cancellationReason?: string | null;
}

export interface ProviderPayment {
  providerRef: string;
  status: ProviderStatus;
  amountAuthorized: string;
  amountCaptured: string;
  amountRefunded: string;
  /** Campos opcionais informados por gateways reais (Asaas). */
  remoteStatus?: string;
  netValue?: string | null;
  refundPending?: boolean;
  refunds?: ProviderRefund[];
  splits?: ProviderSplit[];
  externalReference?: string | null;
  invoiceUrl?: string | null;
  createdAt?: string | null;
}

export interface PixQrCode {
  payload: string;
  encodedImage?: string;
  expirationDate?: string | null;
}

/** Instrução de split enviada na criação da cobrança (cópia da política aprovada). */
export interface SplitInstruction {
  walletId: string;
  percentualValue?: string;
  fixedValue?: string;
  externalReference: string;
  description?: string;
}

export interface ChargeOptions {
  /** Chave idempotente da operação de negócio, enviada como externalReference. */
  externalReference: string;
  customerRemoteId?: string;
  description?: string;
  split?: SplitInstruction[];
  /** Forma de pagamento da cobrança pré-paga (padrão: Pix). */
  billingType?: "PIX" | "CREDIT_CARD";
}

/** Formas pré-pagas: o valor máximo é cobrado antes da recarga e a diferença não consumida é estornada. */
export const PREPAID_METHODS = ["PIX", "CARD"] as const;
export type PrepaidMethod = (typeof PREPAID_METHODS)[number];
export const isPrepaidMethod = (m: string): m is PrepaidMethod => (PREPAID_METHODS as readonly string[]).includes(m);
export const PAYMENT_METHOD_LABEL: Record<string, string> = { PIX: "Pix", CARD: "Cartão", PREAUTH: "Pré-autorização" };

export interface WebhookEvent {
  eventId: string;
  type: string;
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly environment: "SANDBOX" | "PRODUCTION";
  readonly status: "configured" | "not_configured";
  /**
   * PREAUTH: reserva o valor máximo e captura o apurado (sandbox/cartão).
   * PREPAID: o motorista paga antes (Pix); ao final, a diferença não consumida é estornada.
   */
  readonly flow?: "PREAUTH" | "PREPAID";
  /** true: o webhook é persistido e respondido 200 mesmo se o processamento falhar (fila do provedor não pausa). */
  readonly ackWebhookBeforeProcessing?: boolean;
  /** Pré-autorização (PREAUTH) ou criação da cobrança pré-paga (PREPAID). */
  authorize(amount: string, metadata: Record<string, string>, options?: ChargeOptions): Promise<ProviderPayment>;
  capture(providerRef: string, amount: string): Promise<ProviderPayment>;
  cancel(providerRef: string): Promise<ProviderPayment>;
  /** `full`: estorno do pagamento inteiro — no Asaas vai SEM `value` (integral pela documentação), não como parcial. */
  refund(providerRef: string, amount: string, options?: { description?: string; full?: boolean }): Promise<ProviderPayment>;
  /** Recuperação após timeout: encontra a cobrança criada com a chave idempotente. */
  findByExternalReference?(externalReference: string): Promise<ProviderPayment[]>;
  /** Conciliação: cobranças remotas criadas no intervalo. */
  listRemote?(range: { from: Date; to: Date }): Promise<ProviderPayment[]>;
  getPixQrCode?(providerRef: string): Promise<PixQrCode>;
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
