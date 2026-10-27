/**
 * Adaptador de e-mail. Nenhum provedor está contratado/configurado: o adaptador padrão
 * declara "not_configured" e NÃO envia nada. Para ativar, implemente um adaptador real
 * (ex.: SES, SendGrid, Resend) e selecione-o via EMAIL_PROVIDER.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailAdapter {
  readonly name: string;
  readonly status: "configured" | "not_configured";
  send(msg: EmailMessage): Promise<{ delivered: boolean; providerMessageId?: string; reason?: string }>;
}

export const notConfiguredEmail: EmailAdapter = {
  name: "none",
  status: "not_configured",
  async send() {
    return { delivered: false, reason: "Provedor de e-mail não configurado." };
  },
};

export function getEmailAdapter(): EmailAdapter {
  // Nenhum provedor implementado ainda: qualquer valor de EMAIL_PROVIDER resulta em "não configurado".
  return notConfiguredEmail;
}
