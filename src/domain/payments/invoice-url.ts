/** Só abre a página de pagamento se ela for do próprio Asaas (HTTPS): nunca um endereço arbitrário vindo do banco. */
export function safeInvoiceUrl(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "asaas.com" || u.hostname.endsWith(".asaas.com")) ? u.toString() : null;
  } catch {
    return null;
  }
}
