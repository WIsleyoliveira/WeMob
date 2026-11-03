import { processWebhook } from "@/server/payments/service";
import { REQUEST_ID_HEADER, withCorrelation } from "@/server/correlation";
import "@/server/drivers/charging"; // registra o fluxo de recarga que reage à autorização do pagamento

export const dynamic = "force-dynamic";

/** Webhook de provedor de pagamento. Corpo bruto preservado para verificação da assinatura. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  if (raw.length > 64 * 1024) return Response.json({ error: "payload too large" }, { status: 413 });
  const headers = Object.fromEntries(req.headers.entries());
  const r = await withCorrelation(req.headers.get(REQUEST_ID_HEADER) ?? undefined, () => processWebhook(provider, raw, headers));
  return Response.json({ outcome: r.outcome }, { status: r.http });
}
