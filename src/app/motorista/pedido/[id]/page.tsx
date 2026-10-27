import { notFound, redirect } from "next/navigation";
import { getMyChargeRequest } from "@/server/drivers/service";
import { requireDriverPage } from "@/server/drivers/current";
import { cancelChargeAction } from "@/app/actions/driver";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";
import { PixPanel } from "../pix-panel";

export const dynamic = "force-dynamic";

const STEP = { AWAITING_PAYMENT: "Aguardando confirmação do pagamento", START_REQUESTED: "Aguardando o carregador iniciar", STARTED: "Recarga iniciada", FAILED: "Não foi possível iniciar", CANCELLED: "Pedido cancelado", EXPIRED: "Pagamento expirado" } as const;

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const driver = await requireDriverPage();
  const { id } = await params;
  const r = await getMyChargeRequest(driver, id);
  if (!r) notFound();
  if (r.sessionId) redirect(`/motorista/recarga/${r.sessionId}`);
  const waiting = ["AWAITING_PAYMENT", "START_REQUESTED"].includes(r.status);
  return (
    <>
      {waiting && <AutoRefresh ms={3000} />}
      <h1 className="font-display text-xl font-semibold text-navy-900">{STEP[r.status]}</h1>
      {r.demo && <Alert tone="warning" className="mt-3">Demonstração: sem cobrança.</Alert>}
      {waiting && <p className="mt-2 text-sm text-navy-600" role="status">Esta página se atualiza sozinha. Mantenha o cabo conectado.</p>}
      {r.failure && <Alert tone="danger" className="mt-3">{r.failure}</Alert>}
      {r.payment && (
        <p className="mt-3 text-sm">
          Pagamento: <b>{PAYMENT_STATUS_LABEL[r.payment.status]}</b>
          {r.payment.status === "PENDING" ? " — aguardando a confirmação do gateway" : " (situação informada pelo gateway)"}
        </p>
      )}
      {r.status === "AWAITING_PAYMENT" && r.payment?.method === "PIX" && r.payment.status === "PENDING" && (
        r.payment.pixPayload ? (
          <PixPanel requestId={r.id} amount={r.payment.amountAuthorized.toString()} payload={r.payment.pixPayload} expiresAt={r.payment.pixExpiresAt} sandbox={r.payment.environment === "SANDBOX"} />
        ) : (
          <Alert tone="warning" className="mt-3" title="QR Code ainda indisponível">O gateway criou a cobrança, mas o código Pix não foi obtido. Toque em verificar em instantes ou cancele o pedido.</Alert>
        )
      )}
      {r.status === "EXPIRED" && <Alert tone="info" className="mt-3">O Pix não foi pago dentro do prazo e a cobrança foi removida no gateway. Nada foi cobrado.</Alert>}
      <div className="mt-6 flex flex-col gap-3">
        {waiting && <ActionForm action={cancelChargeAction} submitLabel="Cancelar pedido" variant="secondary"><input type="hidden" name="requestId" value={r.id} /></ActionForm>}
        {!waiting && <ButtonLink href="/motorista" variant="secondary">Voltar às estações</ButtonLink>}
      </div>
    </>
  );
}
