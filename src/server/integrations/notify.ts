/**
 * Adaptadores de notificação por canal. NENHUM provedor está contratado: e-mail usa o adaptador
 * existente (não configurado); SMS e WhatsApp não têm adaptador. Notificações para canais não
 * configurados são registradas como "não enviada — canal não configurado", nunca como enviadas.
 */
import type { NotificationChannel } from "@prisma/client";
import { getEmailAdapter } from "./email";

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  readonly name: string;
  readonly status: "configured" | "not_configured";
  send(msg: { to: string; subject: string; body: string }): Promise<{ delivered: boolean; reason?: string }>;
}

const notConfigured = (channel: NotificationChannel): ChannelAdapter => ({
  channel,
  name: "nenhum",
  status: "not_configured",
  async send() {
    return { delivered: false, reason: "Canal não configurado." };
  },
});

export function defaultChannelAdapters(): Record<NotificationChannel, ChannelAdapter> {
  const email = getEmailAdapter();
  return {
    EMAIL: email.status === "configured"
      ? { channel: "EMAIL", name: email.name, status: "configured", send: async (m) => email.send({ to: m.to, subject: m.subject, text: m.body }) }
      : notConfigured("EMAIL"),
    SMS: notConfigured("SMS"),
    WHATSAPP: notConfigured("WHATSAPP"),
  };
}

export const CHANNEL_LABEL: Record<NotificationChannel, string> = { EMAIL: "E-mail", SMS: "SMS", WHATSAPP: "WhatsApp" };
