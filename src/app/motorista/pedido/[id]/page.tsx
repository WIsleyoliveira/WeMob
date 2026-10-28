import { notFound, redirect } from "next/navigation";
import { getMyChargeRequest, syncPendingPayment } from "@/server/drivers/service";
import { requireDriverPage } from "@/server/drivers/current";
import { cancelChargeAction } from "@/app/actions/driver";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { PAYMENT_METHOD_LABEL } from "@/server/payments/provider";
import { PixPanel } from "../pix-panel";
import { CardPanel } from "../card-panel";
import { OrderProgress } from "../progress";
import { pixPaymentWindowMs } from "@/server/drivers/charging";
import { safeInvoiceUrl } from "@/domain/payments/invoice-url";

export const dynamic = "force-dynamic";

/** Prazo real para pagar: a cobrança é removida ao fim da janela da WeMob, mesmo que o QR do gateway valha mais. */
const payBy = (createdAt: Date, gatewayExpiry: Date | null) => {
  const window = new Date(createdAt.getTime() + pixPaymentWindowMs());
  return gatewayExpiry && gatewayExpiry < window ? gatewayExpiry : window;
};

const STEP = { AWAITING_PAYMENT: "Falta só o pagamento", START_REQUESTED: "Aguardando o carregador iniciar", STARTED: "Recarga iniciada", FAILED: "Não foi possível iniciar", CANCELLED: "Pedido cancelado", EXPIRED: "Pagamento expirado" } as const;

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const driver = await requireDriverPage();
  const { id } = await params;
  await syncPendingPayment(driver, id);
  const r = await getMyChargeRequest(driver, id);
  if (!r) notFound();
  if (r.sessionId) redirect(`/motorista/recarga/${r.sessionId}`);
  const waiting = ["AWAITING_PAYMENT", "START_REQUESTED"].includes(r.status);
  const cardUrl = safeInvoiceUrl(r.payment?.invoiceUrl ?? null);
  return (
    <>
      {waiting && <AutoRefresh ms={3000} />}
      <h1 className="font-display text-xl font-semibold text-navy-900">{STEP[r.status]}</h1>
      <OrderProgress status={r.status} demo={r.demo} />
      {r.demo && <Alert tone="warning" className="mt-4">Demonstração: sem cobrança.</Alert>}
      {waiting && (
        <p className="mt-4 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700" role="status">
          {r.status === "START_REQUESTED" ? "Pagamento confirmado. Estamos pedindo ao carregador para iniciar — mantenha o cabo conectado." : "Esta tela confere o pagamento sozinha. Mantenha o cabo conectado ao veículo."}
        </p>
      )}
      {r.failure && <Alert tone="danger" className="mt-4">{r.failure}</Alert>}
      {r.payment && !(r.status === "AWAITING_PAYMENT" && r.payment.status === "PENDING") && (
        <p className="mt-4 text-sm text-navy-700">
          Pagamento ({PAYMENT_METHOD_LABEL[r.payment.method] ?? r.payment.method}): <b>{PAYMENT_STATUS_LABEL[r.payment.status]}</b> <span className="text-navy-500">— situação informada pelo gateway</span>
        </p>
      )}
      {r.status === "AWAITING_PAYMENT" && r.payment?.method === "PIX" && r.payment.status === "PENDING" && (
        r.payment.pixPayload ? (
          <PixPanel requestId={r.id} amount={r.payment.amountAuthorized.toString()} payload={r.payment.pixPayload} expiresAt={payBy(r.createdAt, r.payment.pixExpiresAt)} sandbox={r.payment.environment === "SANDBOX"} />
        ) : (
          <Alert tone="warning" className="mt-3" title="QR Code ainda indisponível">O gateway criou a cobrança, mas o código Pix não foi obtido. Toque em verificar em instantes ou cancele o pedido.</Alert>
        )
      )}
      {r.status === "AWAITING_PAYMENT" && r.payment?.method === "CARD" && r.payment.status === "PENDING" && (
        cardUrl ? (
          <CardPanel requestId={r.id} amount={r.payment.amountAuthorized.toString()} invoiceUrl={cardUrl} sandbox={r.payment.environment === "SANDBOX"} />
        ) : (
          <Alert tone="warning" className="mt-3" title="Página de pagamento indisponível">O gateway criou a cobrança, mas não informou a página de pagamento do cartão. Cancele o pedido e tente de novo ou escolha Pix.</Alert>
        )
      )}
      {r.status === "CANCELLED" && r.payment?.status === "CANCELLED" && <Alert tone="info" className="mt-4">A cobrança foi removida no gateway. Nada foi cobrado.</Alert>}
      {r.status === "EXPIRED" && <Alert tone="info" className="mt-3">O pagamento não foi feito dentro do prazo e a cobrança foi removida no gateway. Nada foi cobrado.</Alert>}
      <div className="mt-6 flex flex-col gap-3">
        {waiting && <ActionForm action={cancelChargeAction} submitLabel="Cancelar pedido" variant="secondary"><input type="hidden" name="requestId" value={r.id} /></ActionForm>}
        {!waiting && <ButtonLink href="/motorista" variant="secondary">Voltar às estações</ButtonLink>}
      </div>
    </>
  );
}
